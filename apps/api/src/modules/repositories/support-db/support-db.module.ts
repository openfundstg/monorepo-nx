import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import {
  SupportBotUser,
  SupportBotUserSchema,
  SupportMessageLink,
  SupportMessageLinkSchema,
  SupportTopic,
  SupportTopicSchema
} from './schemas'
import {
  SupportBotUserDbService,
  SupportMessageLinkDbService,
  SupportTopicDbService
} from './services'

/**
 * One repository module, three collections — the shape the rules prescribe for
 * a domain that owns several: `support_topics` is a conversation's thread,
 * `support_bot_users` is a person the bot has met (most people who press a
 * button are only ever that), and `support_message_links` is how one message
 * is found on the other side of the relay when somebody replies to it.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportTopic.name, schema: SupportTopicSchema },
      { name: SupportBotUser.name, schema: SupportBotUserSchema },
      { name: SupportMessageLink.name, schema: SupportMessageLinkSchema }
    ])
  ],
  providers: [SupportTopicDbService, SupportBotUserDbService, SupportMessageLinkDbService],
  exports: [SupportTopicDbService, SupportBotUserDbService, SupportMessageLinkDbService]
})
export class SupportDbModule {}
