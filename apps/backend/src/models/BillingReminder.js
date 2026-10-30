const mongoose = require('mongoose');

const billingReminderSchema = new mongoose.Schema(
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
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SocietyMembership',
      required: true,
      immutable: true,
    },
    kind: { type: String, enum: ['issued', 'due_soon', 'overdue'], required: true },
    reminderDateKey: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

billingReminderSchema.index(
  { societyId: 1, billId: 1, membershipId: 1, kind: 1, reminderDateKey: 1 },
  { unique: true },
);
billingReminderSchema.index({ societyId: 1, membershipId: 1, createdAt: -1 });

module.exports =
  mongoose.models.BillingReminder || mongoose.model('BillingReminder', billingReminderSchema);
