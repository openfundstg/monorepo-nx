import { ChangeDetectionStrategy, Component, signal, inject, OnInit, OnDestroy, computed } from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { TranslatePipe, TranslateService } from '@ngx-translate/core'
import { ApiErrorService } from '../../../shared/services/api-error.service'
import { DepositService } from '../../services/deposit.service'
import { TmaService } from '../../../auth/services/tma.service'
import { TmaDepositStatus } from '@transacto/contracts'

@Component({
  selector: 'app-deposit-verify',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './deposit-verify.component.html',
  styleUrl: './deposit-verify.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DepositVerifyComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute)
  private readonly translate = inject(TranslateService)
  private readonly apiError = inject(ApiErrorService)
  private readonly router = inject(Router)
  private readonly depositService = inject(DepositService)
  private readonly tma = inject(TmaService)

  readonly deposit = signal<any>(null)
  readonly walletAddress = signal('')
  readonly txId = signal('')
  readonly verifying = signal(false)
  readonly copied = signal(false)
  readonly errorMsg = signal('')
  readonly balanceCredited = signal(0)
  readonly currentStatus = signal<string>('PENDING')
  readonly timeRemaining = signal(0)

  readonly isVerified = computed(() =>
    this.currentStatus() === 'COMPLETED' || this.currentStatus() === 'PAID_LATE'
  )

  readonly formattedTime = computed(() => {
    const secs = this.timeRemaining()
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  })

  private timerInterval: any = null

  async ngOnInit() {
    this.tma.showBackButton(() => this.router.navigate(['/']))

    const depositId = this.route.snapshot.params['id']
    try {
      const [depositRes, configRes] = await Promise.all([
        this.depositService.getById(depositId),
        this.depositService.getConfig()
      ])
      this.deposit.set(depositRes)
      this.walletAddress.set(configRes.walletAddress)
      this.currentStatus.set(depositRes.status)
      this.startCountdown(depositRes.expiresAt)
    } catch (err) {
      console.error('Failed to load deposit:', err)
    }
  }

  ngOnDestroy() {
    if (this.timerInterval) clearInterval(this.timerInterval)
    this.tma.hideBackButton()
  }

  private startCountdown(expiresAt: string) {
    const update = () => {
      const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      this.timeRemaining.set(remaining)
      if (remaining <= 0 && this.timerInterval) {
        clearInterval(this.timerInterval)
      }
    }
    update()
    this.timerInterval = setInterval(update, 1000)
  }

  async copyAddress() {
    try {
      await navigator.clipboard.writeText(this.walletAddress())
      this.copied.set(true)
      this.tma.hapticFeedback('light')
      setTimeout(() => this.copied.set(false), 2000)
    } catch {
      /* clipboard not available */
    }
  }

  async onVerify() {
    const depositId = this.deposit()?._id
    const txId = this.txId()
    if (!depositId || txId.length !== 64) return

    this.verifying.set(true)
    this.errorMsg.set('')

    try {
      const result = await this.depositService.verifyTx(depositId, txId)
      if (result.success) {
        this.currentStatus.set(result.status)
        this.balanceCredited.set(result.balanceCredited ?? 0)
        this.tma.hapticFeedback('success')
      }
    } catch (err: any) {
      const msg = this.apiError.messageFor(err, 'deposit.error')
      this.errorMsg.set(msg)
      this.tma.hapticFeedback('error')
    } finally {
      this.verifying.set(false)
    }
  }

  goToDashboard() {
    this.router.navigate(['/'])
  }

  formatUah(kopecks: number): string {
    return (kopecks / 100).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  formatUsdt(cents: number): string {
    return (cents / 100).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}
