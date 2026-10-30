const mongoose = require('mongoose');

const journalEntrySchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    entryNumber: { type: String, required: true, immutable: true },
    entryDate: { type: Date, required: true, immutable: true },
    currency: { type: String, required: true, uppercase: true, immutable: true },
    description: { type: String, required: true, trim: true, maxlength: 240, immutable: true },
    sourceType: { type: String, required: true, immutable: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    debitTotalMinor: { type: Number, required: true, min: 0, immutable: true },
    creditTotalMinor: { type: Number, required: true, min: 0, immutable: true },
    status: { type: String, enum: ['posted', 'reversed'], default: 'posted', immutable: true },
    reversalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JournalEntry',
      default: null,
      immutable: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true,
    },
    lineSnapshots: {
      type: [
        {
          accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
          side: { type: String, enum: ['debit', 'credit'], required: true },
          amountMinor: { type: Number, min: 1, required: true },
          memo: { type: String, trim: true, maxlength: 240, default: null },
        },
      ],
      required: true,
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false },
);

journalEntrySchema.index({ societyId: 1, sourceType: 1, sourceId: 1 }, { unique: true });
journalEntrySchema.index({ societyId: 1, entryNumber: 1 }, { unique: true });
journalEntrySchema.index({ societyId: 1, entryDate: -1 });

module.exports = mongoose.models.JournalEntry || mongoose.model('JournalEntry', journalEntrySchema);
