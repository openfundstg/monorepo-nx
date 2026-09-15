import { IsString, Length } from 'class-validator'

export class VerifyTxDto {
  @IsString()
  @Length(64, 64) // TRC-20 tx hashes are 64 hex chars
  txId: string
}
