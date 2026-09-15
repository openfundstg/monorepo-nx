import { IsOptional, IsString, IsEnum, IsInt, Min, IsIn } from 'class-validator'
import { Type } from 'class-transformer'
import { SafeBoxStatus } from 'src/modules/repositories/safe-box-db/schemas'

export class SafeBoxListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20

  @IsOptional()
  @IsString()
  term?: string

  @IsOptional()
  @IsEnum(SafeBoxStatus)
  status?: SafeBoxStatus

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt'

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'
}
