import { IsEnum, IsNotEmpty, IsString, MaxLength } from 'class-validator'
import { BankProvider } from 'src/shared/constants'
import type { ResolveDropLinkReq } from '@transacto/contracts'

/** Longer than any bank link, short enough that the parser is never handed a novel. */
const MAX_LINK_LENGTH = 2_048

export class ResolveDropLinkReqDto implements ResolveDropLinkReq {
  @IsEnum(BankProvider)
  readonly bankType: BankProvider

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_LINK_LENGTH)
  readonly link: string
}
