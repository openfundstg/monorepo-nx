export { TelegramMiniAppModule } from './telegram-mini-app.module'
// Called by the support bot, whose inline keys answer a card sale's orders.
// The direction is one-way and stays that way: the Mini App still learns of
// the bot only through a neutral domain event.
export { SaleCardOrderService } from './services/sale-card-order.service'
