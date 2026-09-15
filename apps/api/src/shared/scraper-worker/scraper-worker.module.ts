import { HttpModule } from '@nestjs/axios'
import { Global, Module } from '@nestjs/common'
import { ScraperWorkerApiService } from 'src/shared/scraper-worker/scraper-worker.api.service'
import { ScraperWorkerService } from 'src/shared/scraper-worker/scraper-worker.service'

/**
 * The one client for the Isolated Scraper Worker, for the whole process.
 *
 * Global for the same reason {@link ProxyModule} is: it is the way out to
 * everything the worker fronts, every consumer wants the same one, and the
 * rotation policy only means anything if the instance is shared.
 */
@Global()
@Module({
  imports: [HttpModule.register({ maxRedirects: 0 })],
  providers: [ScraperWorkerApiService, ScraperWorkerService],
  exports: [ScraperWorkerService, ScraperWorkerApiService]
})
export class ScraperWorkerModule {}
