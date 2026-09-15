import { IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class MoveToBoxDto {
  @IsNumber({}, { message: 'amount must be a valid number (in kopecks)' })
  @Min(1)
  amount: number

  @IsString()
  @IsOptional()
  comment?: string
}

export class ForceMatchDto {
  @IsNumber()
  orderId: number

  @IsNumber({}, { message: 'actualAmount must be a valid number (in kopecks)' })
  @Min(1)
  actualAmount: number
}
