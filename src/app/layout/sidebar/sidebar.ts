import { Component, inject } from '@angular/core';
import { LayoutService } from '../layout-service';
import { RouterLink, RouterLinkActive } from '@angular/router';
interface MenuItem { label: string; icon: string; link: string; }

@Component({
  imports: [RouterLink, RouterLinkActive],
  selector: 'app-sidebar',
  styleUrl: './sidebar.scss',
  templateUrl: './sidebar.html',
})
export class Sidebar {


  constructor(private layout:LayoutService)
  {
    
  }

  menu: MenuItem[] = [
    { label: 'Dashboard', icon: '🏠', link: '/dashboard' },
    { label: 'Users', icon: '👥', link: '/users' },
    { label: 'Products', icon: '📦', link: '/products' },
    { label: 'Reports', icon: '📊', link: '/reports' },
    { label: 'Settings', icon: '⚙️', link: '/settings' },
  ];

}
