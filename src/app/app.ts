
import {
  Component,
  ElementRef,
  ViewChild,
  OnDestroy
} from '@angular/core';

import {
  createWorker,
  Worker,
  PSM
} from 'tesseract.js';

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DragMode = 'move' | 'resize' | null;

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnDestroy {

  @ViewChild('video')
  video!: ElementRef<HTMLVideoElement>;

  @ViewChild('canvas')
  canvas!: ElementRef<HTMLCanvasElement>;

  @ViewChild('preview')
  preview!: ElementRef<HTMLDivElement>;

  stream: MediaStream | null = null;
  worker: Worker | null = null;

  isCameraRunning = false;
  isStarting = false;
  isOCRReady = false;
  isOCRInitializing = false;
  isProcessing = false;

  capturedImage: string | null = null;
  extractedText = '';
  previousText = '';

  scanCount = 0;
  ocrProgress = 0;
  ocrConfidence = 0;

  captureTime = 0;
  ocrTime = 0;
  totalTime = 0;

  statusMessage = 'Camera not started';
  errorMessage = '';

  // Select the entire camera frame initially.
  // Move and resize the green box around the phone.
  crop: CropRegion = {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  };

  private readonly SCAN_INTERVAL = 2000;
  private readonly MAX_OCR_WIDTH = 1800;
  private readonly MIN_CROP_SIZE = 0.08;

  // Run a second OCR pass only when the first result is weak.
  private readonly RETRY_CONFIDENCE = 65;
  private readonly RETRY_MIN_CHARACTERS = 30;

  private timer: ReturnType<typeof setInterval> | null = null;
  private ocrInitialization: Promise<void> | null = null;

  private destroyed = false;
  private sessionId = 0;

  private dragMode: DragMode = null;
  private activePointerId: number | null = null;

  private dragStartX = 0;
  private dragStartY = 0;

  private initialCrop: CropRegion = {
    x: 0,
    y: 0,
    width: 1,
    height: 1
  };

  private clamp(
    value: number,
    min: number,
    max: number
  ): number {
    return Math.min(max, Math.max(min, value));
  }

  // ============================================
  // START CAMERA
  // ============================================

  async startCamera(): Promise<void> {
    if (
      this.isStarting ||
      this.isCameraRunning ||
      this.destroyed
    ) {
      return;
    }

    this.isStarting = true;
    this.errorMessage = '';
    this.statusMessage = 'Opening camera...';

    const session = ++this.sessionId;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera access requires localhost or HTTPS.'
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'environment'
        },
        audio: false
      });

      if (this.destroyed || session !== this.sessionId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      this.stream = stream;

      const videoElement = this.video.nativeElement;
      videoElement.srcObject = stream;

      await videoElement.play();

      if (this.destroyed || session !== this.sessionId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      this.isCameraRunning = true;
      this.statusMessage = 'Camera running';

      this.captureFrame();

      if (this.timer !== null) {
        clearInterval(this.timer);
      }

      this.timer = setInterval(() => {
        if (!this.isCameraRunning || this.destroyed) {
          return;
        }

        // Update the captured image independently of OCR.
        if (!this.isProcessing) {
          this.captureFrame();
        }

        if (this.isOCRReady) {
          void this.captureAndExtract();
        }
      }, this.SCAN_INTERVAL);

      if (this.isOCRReady) {
        void this.captureAndExtract();
      } else {
        void this.initializeOCR();
      }

    } catch (error) {
      console.error('Camera error:', error);

      if (session === this.sessionId) {
        this.stopCamera();

        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'Unable to start camera';

        this.statusMessage = 'Camera error';
      }

    } finally {
      this.isStarting = false;
    }
  }

  // ============================================
  // STOP CAMERA
  // ============================================

  stopCamera(): void {
    this.sessionId++;
    this.endDrag();

    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.isCameraRunning = false;

    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;

    if (this.video) {
      this.video.nativeElement.srcObject = null;
    }

    this.statusMessage = 'Camera stopped';
  }

  // ============================================
  // CROP RECTANGLE
  // ============================================

  private beginDrag(
    event: PointerEvent,
    mode: DragMode
  ): void {
    if (!this.isCameraRunning) return;

    event.preventDefault();
    event.stopPropagation();

    const rect =
      this.preview.nativeElement.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    this.dragMode = mode;
    this.activePointerId = event.pointerId;

    this.dragStartX = event.clientX / rect.width;
    this.dragStartY = event.clientY / rect.height;

    this.initialCrop = { ...this.crop };

    const target = event.currentTarget as HTMLElement;

    target.setPointerCapture(event.pointerId);
  }

  startMove(event: PointerEvent): void {
    this.beginDrag(event, 'move');
  }

  startResize(event: PointerEvent): void {
    this.beginDrag(event, 'resize');
  }

  onPointerMove(event: PointerEvent): void {
    if (
      !this.dragMode ||
      this.activePointerId !== event.pointerId
    ) {
      return;
    }

    const rect =
      this.preview.nativeElement.getBoundingClientRect();

    if (!rect.width || !rect.height) return;

    const dx =
      (event.clientX - this.dragStartX * rect.width) /
      rect.width;

    const dy =
      (event.clientY - this.dragStartY * rect.height) /
      rect.height;

    if (this.dragMode === 'move') {
      this.crop = {
        ...this.initialCrop,
        x: this.clamp(
          this.initialCrop.x + dx,
          0,
          1 - this.initialCrop.width
        ),
        y: this.clamp(
          this.initialCrop.y + dy,
          0,
          1 - this.initialCrop.height
        )
      };
    } else {
      this.crop = {
        ...this.initialCrop,
        width: this.clamp(
          this.initialCrop.width + dx,
          this.MIN_CROP_SIZE,
          1 - this.initialCrop.x
        ),
        height: this.clamp(
          this.initialCrop.height + dy,
          this.MIN_CROP_SIZE,
          1 - this.initialCrop.y
        )
      };
    }
  }

  endDrag(): void {
    this.dragMode = null;
    this.activePointerId = null;
  }

  resetCrop(): void {
    this.crop = {
      x: 0.15,
      y: 0.05,
      width: 0.70,
      height: 0.90
    };

    if (this.isCameraRunning) {
      this.captureFrame();
    }
  }

  selectFullFrame(): void {
    this.crop = {
      x: 0,
      y: 0,
      width: 1,
      height: 1
    };

    if (this.isCameraRunning) {
      this.captureFrame();
    }
  }

  // ============================================
  // CAPTURE CROPPED CAMERA IMAGE
  // ============================================

  private createCropCanvas(): HTMLCanvasElement {
    const videoElement = this.video.nativeElement;

    const videoWidth = videoElement.videoWidth;
    const videoHeight = videoElement.videoHeight;

    if (!videoWidth || !videoHeight) {
      throw new Error('Camera frame is not ready');
    }

    const sourceX = Math.floor(
      this.crop.x * videoWidth
    );

    const sourceY = Math.floor(
      this.crop.y * videoHeight
    );

    const sourceWidth = Math.max(
      1,
      Math.min(
        videoWidth - sourceX,
        Math.floor(this.crop.width * videoWidth)
      )
    );

    const sourceHeight = Math.max(
      1,
      Math.min(
        videoHeight - sourceY,
        Math.floor(this.crop.height * videoHeight)
      )
    );

    // Do not unnecessarily upscale blurry frames.
    const scale = Math.min(
      1,
      this.MAX_OCR_WIDTH / sourceWidth
    );

    const canvas = document.createElement('canvas');

    canvas.width = Math.max(
      1,
      Math.round(sourceWidth * scale)
    );

    canvas.height = Math.max(
      1,
      Math.round(sourceHeight * scale)
    );

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Unable to create canvas');
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    ctx.drawImage(
      videoElement,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    return canvas;
  }

  // ============================================
  // DISPLAY CAPTURED IMAGE
  // ============================================

  captureFrame(): void {
    if (!this.isCameraRunning || this.destroyed) {
      return;
    }

    try {
      const start = performance.now();

      const image = this.createCropCanvas();

      this.showCapturedImage(image);

      this.captureTime = Math.round(
        performance.now() - start
      );

    } catch (error) {
      console.error('Capture error:', error);
    }
  }

  private showCapturedImage(
    source: HTMLCanvasElement
  ): void {
    const canvas = this.canvas.nativeElement;

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Capture canvas unavailable');
    }

    ctx.drawImage(source, 0, 0);

    this.capturedImage = canvas.toDataURL(
      'image/png'
    );
  }

  // ============================================
  // INITIALIZE OCR WORKER
  // ============================================

  async initializeOCR(): Promise<void> {
    if (this.destroyed || this.isOCRReady) {
      return;
    }

    if (this.ocrInitialization) {
      return this.ocrInitialization;
    }

    this.isOCRInitializing = true;
    this.ocrProgress = 0;
    this.statusMessage = 'Initializing local OCR...';

    this.ocrInitialization = (async () => {
      let createdWorker: Worker | null = null;

      try {
        const start = performance.now();

        createdWorker = await createWorker('eng', 1, {
          workerPath: '/ocr/worker.min.js',
          corePath: '/ocr/',
          langPath: '/ocr/',
          gzip: true,
          logger: message => {
            if (this.destroyed) return;

            this.ocrProgress = Math.round(
              (message.progress ?? 0) * 100
            );

            if (
              this.isCameraRunning &&
              !this.isProcessing
            ) {
              this.statusMessage =
                `${message.status}: ${this.ocrProgress}%`;
            }
          }
        });

        if (this.destroyed) {
          await createdWorker.terminate();
          return;
        }

        // Automatic page segmentation works better
        // for headings, paragraphs, and mixed layouts.
        await createdWorker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: '1'
        });

        if (this.destroyed) {
          await createdWorker.terminate();
          return;
        }

        this.worker = createdWorker;
        this.isOCRReady = true;
        this.ocrProgress = 100;

        console.log(
          'OCR initialization time:',
          Math.round(performance.now() - start),
          'ms'
        );

        if (this.isCameraRunning) {
          this.statusMessage = 'OCR ready - scanning';
          void this.captureAndExtract();
        } else {
          this.statusMessage = 'OCR ready';
        }

      } catch (error) {
        if (createdWorker) {
          await createdWorker.terminate().catch(() => {});
        }

        console.error('OCR initialization error:', error);

        if (!this.destroyed) {
          this.errorMessage =
            error instanceof Error
              ? error.message
              : 'OCR initialization failed';

          this.statusMessage = 'OCR initialization failed';
        }

      } finally {
        this.isOCRInitializing = false;
        this.ocrInitialization = null;
      }
    })();

    return this.ocrInitialization;
  }

  // ============================================
  // IMAGE ENHANCEMENT
  // ============================================

  private preprocessImage(
    source: HTMLCanvasElement
  ): HTMLCanvasElement {
    const canvas = document.createElement('canvas');

    canvas.width = source.width;
    canvas.height = source.height;

    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Image processing unavailable');
    }

    // Mild enhancement preserves text edges better
    // than aggressive thresholding.
    ctx.filter = 'grayscale(100%) contrast(115%)';

    ctx.drawImage(
      source,
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.filter = 'none';

    return canvas;
  }

  // ============================================
  // OCR RESULT SCORING
  // ============================================

  private scoreOCR(
    text: string,
    confidence: number
  ): number {
    const characters =
      (text.match(/[a-zA-Z0-9]/g) ?? []).length;

    const words =
      (text.match(/\b[a-zA-Z]{2,}\b/g) ?? []).length;

    return (
      confidence +
      Math.min(characters, 150) * 0.15 +
      Math.min(words, 30) * 0.5
    );
  }

  // ============================================
  // AUTOMATIC OCR RECOGNITION
  // ============================================

  async captureAndExtract(): Promise<void> {
    if (
      !this.isCameraRunning ||
      !this.isOCRReady ||
      !this.worker ||
      this.isProcessing ||
      this.destroyed
    ) {
      return;
    }

    const session = this.sessionId;
    const worker = this.worker;

    this.isProcessing = true;
    this.errorMessage = '';
    this.statusMessage = 'Extracting text...';

    try {
      const start = performance.now();

      // Capture a fresh image from the camera.
      const original = this.createCropCanvas();

      // Show the exact original image being scanned.
      this.showCapturedImage(original);

      this.captureTime = Math.round(
        performance.now() - start
      );

      const ocrStart = performance.now();

      // Pass 1: original camera image
      const originalResult =
        await worker.recognize(original);

      let bestResult = originalResult;

      const originalText =
        originalResult.data.text.trim();

      console.log('Original OCR:', originalText);
      console.log(
        'Original confidence:',
        originalResult.data.confidence
      );

      // Pass 2: enhanced image only when needed
      if (
        originalResult.data.confidence <
          this.RETRY_CONFIDENCE ||
        originalText.length <
          this.RETRY_MIN_CHARACTERS
      ) {
        const enhanced =
          this.preprocessImage(original);

        const enhancedResult =
          await worker.recognize(enhanced);

        const originalScore = this.scoreOCR(
          originalResult.data.text,
          originalResult.data.confidence
        );

        const enhancedScore = this.scoreOCR(
          enhancedResult.data.text,
          enhancedResult.data.confidence
        );

        console.log(
          'Enhanced OCR:',
          enhancedResult.data.text
        );

        console.log(
          'Enhanced confidence:',
          enhancedResult.data.confidence
        );

        if (enhancedScore > originalScore) {
          bestResult = enhancedResult;
        }
      }

      // Ignore results from an old camera session.
      if (
        this.destroyed ||
        !this.isCameraRunning ||
        session !== this.sessionId
      ) {
        return;
      }

      this.ocrTime = Math.round(
        performance.now() - ocrStart
      );

      this.totalTime = Math.round(
        performance.now() - start
      );

      const text = bestResult.data.text.trim();

      this.extractedText = text;

      this.ocrConfidence = Math.round(
        bestResult.data.confidence
      );

      this.scanCount++;

      if (text && text !== this.previousText) {
        this.previousText = text;
        this.statusMessage = 'New text detected';
      } else if (text) {
        this.statusMessage = 'Text unchanged';
      } else {
        this.statusMessage =
          'OCR completed, but no readable text found';
      }

      console.log('Final extracted text:', text);

      console.table({
        scanCount: this.scanCount,
        confidence: `${this.ocrConfidence}%`,
        captureTime: `${this.captureTime} ms`,
        ocrTime: `${this.ocrTime} ms`,
        totalTime: `${this.totalTime} ms`,
        characters: text.length
      });

    } catch (error) {
      console.error('OCR processing error:', error);

      if (
        !this.destroyed &&
        session === this.sessionId
      ) {
        this.errorMessage =
          error instanceof Error
            ? error.message
            : 'OCR processing failed';

        this.statusMessage = 'OCR processing failed';
      }

    } finally {
      this.isProcessing = false;
    }
  }

  // ============================================
  // CLEAR OCR RESULTS
  // ============================================

  clearText(): void {
    this.extractedText = '';
    this.previousText = '';
    this.capturedImage = null;

    this.scanCount = 0;
    this.ocrConfidence = 0;

    this.captureTime = 0;
    this.ocrTime = 0;
    this.totalTime = 0;

    this.errorMessage = '';

    this.statusMessage = this.isCameraRunning
      ? 'Waiting for next scan...'
      : 'Camera stopped';
  }

  // ============================================
  // CLEANUP
  // ============================================

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopCamera();

    const pending = this.ocrInitialization;

    if (pending) {
      void pending.then(() => {
        if (this.worker) {
          void this.worker.terminate();
          this.worker = null;
        }
      });
    } else if (this.worker) {
      void this.worker.terminate();
      this.worker = null;
    }
  }
}
