const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      immutable: true,
    },
    expenseAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      immutable: true,
    },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    currency: { type: String, required: true, uppercase: true, immutable: true },
    incurredAt: { type: Date, required: true, immutable: true },
    description: { type: String, required: true, trim: true, maxlength: 240, immutable: true },
    reference: { type: String, trim: true, maxlength: 120, default: null, immutable: true },
    supportingDocument: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
      immutable: true,
    },
    status: {
      type: String,
      enum: [
        'draft',
        'pending_approval',
        'approved',
        'posted',
        'partially_paid',
        'paid',
        'reversed',
      ],
      default: 'draft',
      required: true,
    },
    paidMinor: { type: Number, min: 0, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    postedAt: { type: Date, default: null },
    journalEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense', default: null },
    reversalJournalEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
    },
    reversalReason: { type: String, trim: true, maxlength: 500, default: null },
    approvalUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    vendorPayments: [
      {
        amountMinor: { type: Number, min: 1, required: true },
        paidAt: { type: Date, required: true },
        method: {
          type: String,
          enum: ['cash', 'bank_transfer', 'cheque', 'other'],
          required: true,
        },
        reference: { type: String, trim: true, maxlength: 120, default: null },
        journalEntryId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'JournalEntry',
          required: true,
        },
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        reversalJournalEntryId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'JournalEntry',
          default: null,
        },
        reversedAt: { type: Date, default: null },
        reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        reversalReason: { type: String, trim: true, maxlength: 500, default: null },
      },
    ],
  },
  { timestamps: true, versionKey: false },
);

expenseSchema.index({ societyId: 1, status: 1, incurredAt: -1 });

module.exports = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
