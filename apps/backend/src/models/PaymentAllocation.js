const mongoose = require('mongoose');

const paymentAllocationSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
      immutable: true,
    },
    receiptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Receipt',
      default: null,
      immutable: true,
    },
    refundId: { type: mongoose.Schema.Types.ObjectId, default: null, immutable: true },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MaintenanceBill',
      required: true,
      immutable: true,
    },
    amountMinor: { type: Number, required: true, min: 1, immutable: true },
    kind: {
      type: String,
      enum: ['collection', 'refund', 'reversal'],
      required: true,
      immutable: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false },
);

paymentAllocationSchema.index(
  { societyId: 1, paymentId: 1, billId: 1, kind: 1, refundId: 1 },
  { unique: true },
);
paymentAllocationSchema.index({ societyId: 1, billId: 1, createdAt: 1 });

module.exports =
  mongoose.models.PaymentAllocation || mongoose.model('PaymentAllocation', paymentAllocationSchema);
