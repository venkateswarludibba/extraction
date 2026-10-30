// layout/header/header.component.ts
import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LayoutService } from '../layout-service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './header.html',
  styleUrl: './header.scss',
})
export class Header {
  constructor(private layout: LayoutService) {

  }

  private host = inject(ElementRef);

  userMenuOpen = signal(false);
  notifications = signal(3);   // replace with real data later

  toggleUserMenu() { this.userMenuOpen.update(v => !v); }

  // close the dropdown when clicking anywhere outside the header
  @HostListener('document:click', ['$event'])
  onDocClick(e: Event) {
    if (!this.host.nativeElement.contains(e.target)) this.userMenuOpen.set(false);
  }

  // close on Esc
  @HostListener('document:keydown.escape')
  onEsc() { this.userMenuOpen.set(false); }

  logout() {
    // call your AuthService.logout() here
  }
}