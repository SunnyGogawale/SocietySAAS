const mongoose = require('mongoose');

const creditNoteSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceBill',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true, immutable: true },
    ownerMembershipIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'SocietyMembership' }],
      immutable: true,
      default: [],
    },
    noteNumber: { type: String, default: null },
    direction: { type: String, enum: ['credit', 'debit'], required: true, immutable: true },
    category: {
      type: String,
      enum: ['adjustment', 'discount', 'late_fee', 'penalty'],
      required: true,
      immutable: true,
    },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    allocations: [
      {
        billId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceBill', required: true },
        amountMinor: { type: Number, required: true, min: 1 },
      },
    ],
    unappliedMinor: { type: Number, min: 0, default: 0 },
    currency: { type: String, required: true, uppercase: true, immutable: true },
    reason: { type: String, required: true, trim: true, maxlength: 500, immutable: true },
    accrualKey: { type: String, default: null, immutable: true },
    status: {
      type: String,
      enum: ['pending_approval', 'approved', 'issued', 'cancelled'],
      default: 'pending_approval',
      required: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    issuedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

creditNoteSchema.index(
  { societyId: 1, accrualKey: 1 },
  { unique: true, partialFilterExpression: { accrualKey: { $type: 'string' } } },
);
creditNoteSchema.index({ societyId: 1, billId: 1, status: 1 });
creditNoteSchema.index(
  { societyId: 1, noteNumber: 1 },
  { unique: true, partialFilterExpression: { noteNumber: { $type: 'string' } } },
);

module.exports = mongoose.models.CreditNote || mongoose.model('CreditNote', creditNoteSchema);
