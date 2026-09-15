import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { QueryFilter, Model, Types } from 'mongoose'
import { AdminAuditLog, AdminAuditLogDocument } from 'src/modules/repositories/admin-db/schemas'
import type { Page, PageQuery } from 'src/modules/repositories/interfaces'

/** A lean audit row plus its id — what every read here returns. */
export type StoredAdminAuditLog = AdminAuditLog & { _id: Types.ObjectId }

/**
 * The audit trail's only door.
 *
 * There is an `append` and there are reads. No delete, and no update that an
 * operator can reach — not because Mongo forbids it, but because the collection
 * is worthless if it can be rewritten by the same person it is recording.
 *
 * {@link renameEnumValue} is the single exception, and it is not a hole in that
 * rule: it exists for a migration, it changes the *spelling* of a
 * classification the product renamed, and it can alter neither who did
 * something nor what they did to whom.
 */
@Injectable()
export class AdminAuditLogDbService {
  constructor(
    @InjectModel(AdminAuditLog.name)
    private readonly auditModel: Model<AdminAuditLogDocument>
  ) {}

  async append(entry: Omit<AdminAuditLog, 'createdAt'>): Promise<StoredAdminAuditLog> {
    const created = await this.auditModel.create(entry)

    return created.toObject()
  }

  async findPage(
    filter: QueryFilter<AdminAuditLog>,
    page: PageQuery
  ): Promise<Page<StoredAdminAuditLog>> {
    const [items, total] = await Promise.all([
      this.auditModel.find(filter).sort(page.sort).skip(page.skip).limit(page.limit).lean(),
      this.auditModel.countDocuments(filter)
    ])

    return { items, total }
  }
  /**
   * Rewrites one stored enum value, on whichever column holds it.
   *
   * One method for `action` and `targetType` because it is one operation on two
   * columns — and because writing it twice is how the second one gets forgotten,
   * which is exactly what happened: the rename that produced this migrated the
   * actions and left every `targetType` reading `SCROLL_ORDER`, one field over
   * in the same document.
   *
   * The panel renders both by concatenating the stored value onto a translation
   * key, so a row left holding a name the enum no longer has shows an operator a
   * raw string instead of a sentence.
   *
   * Idempotent: the old value is the filter.
   */
  async renameEnumValue(field: 'action' | 'targetType', from: string, to: string): Promise<number> {
    const { modifiedCount } = await this.auditModel.updateMany(
      { [field]: from } as QueryFilter<AdminAuditLog>,
      { $set: { [field]: to } }
    )

    return modifiedCount ?? 0
  }

}
