import { Service, signal } from '@angular/core';

@Service()
export class LayoutService {

    collopsed = signal(false)
    mobileOpen = signal(false)

    toggle(){
        if(window.innerWidth <=768)
            this.mobileOpen.update(v => !v);
        else 
            this.collopsed.update(v => !v);
    }

    mobileClose(){
        this.mobileOpen.set(false);
    }

}
