import { Module } from '@nestjs/common'
import { TraderDbModule } from 'src/modules/repositories/trader-db/trader-db.module'
import { TraderAuthService } from 'src/modules/auth/services/trader-auth.service'
import { TmaAuthService } from 'src/modules/auth/services/tma-auth.service'
import { AdminAuthService } from 'src/modules/auth/services/admin-auth.service'
import { AdminSessionService } from 'src/modules/auth/services/admin-session.service'
import { UserTypesGuard } from 'src/modules/auth/guards/user-types.guard'
import { CsrfGuard } from 'src/modules/auth/guards/csrf.guard'

/**
 * Owns every authentication scheme in the app.
 *
 * The guards themselves are registered as `APP_GUARD` in `AppModule`, where
 * their execution order is visible in one place; this module only supplies
 * them and their dependencies.
 */
@Module({
  imports: [TraderDbModule],
  providers: [
    TraderAuthService,
    TmaAuthService,
    AdminAuthService,
    AdminSessionService,
    UserTypesGuard,
    CsrfGuard
  ],
  exports: [
    TraderAuthService,
    TmaAuthService,
    AdminAuthService,
    AdminSessionService,
    UserTypesGuard,
    CsrfGuard
  ]
})
export class AuthModule {}
