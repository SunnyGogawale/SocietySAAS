const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    receiptNumber: { type: String, required: true },
    payerMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocietyMembership',
      required: true,
      immutable: true,
    },
    flatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Flat', required: true, immutable: true },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    currency: { type: String, required: true, uppercase: true, immutable: true },
    receivedAt: { type: Date, required: true, immutable: true },
    method: {
      type: String,
      enum: ['cash', 'bank_transfer', 'cheque', 'other'],
      required: true,
      immutable: true,
    },
    reference: { type: String, trim: true, maxlength: 120, default: null, immutable: true },
    allocations: [
      {
        billId: { type: mongoose.Schema.Types.ObjectId, ref: 'MaintenanceBill', required: true },
        amountMinor: { type: Number, required: true, min: 1 },
      },
    ],
    unappliedMinor: { type: Number, required: true, min: 0 },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    allocationMode: { type: String, enum: ['fifo', 'manual'], required: true },
    reason: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true, versionKey: false },
);

receiptSchema.index({ societyId: 1, receiptNumber: 1 }, { unique: true });
receiptSchema.index({ societyId: 1, flatId: 1, receivedAt: -1 });
receiptSchema.index({ societyId: 1, 'allocations.billId': 1 });

module.exports = mongoose.models.Receipt || mongoose.model('Receipt', receiptSchema);
