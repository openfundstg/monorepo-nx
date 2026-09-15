import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SafeBoxApiService } from './safe-box.api.service';
import type { SafeBoxPage, SafeBoxQuery } from '../interfaces/safe-box.interface';

@Injectable({ providedIn: 'root' })
export class SafeBoxService {
  private readonly api = inject(SafeBoxApiService);

  async list(query: SafeBoxQuery): Promise<SafeBoxPage | null> {
    try {
      return await firstValueFrom(this.api.list(query));
    } catch (err) {
      console.error('Failed to fetch safe box data', err);
      return null;
    }
  }
}
