const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 10000 },
    status: {
      type: String,
      enum: ['open', 'in_progress', 'resolved', 'closed'],
      default: 'open',
      required: true,
    },
    priority: { type: String, enum: ['normal', 'urgent'], default: 'normal', required: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    platformUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

supportTicketSchema.index({ status: 1, updatedAt: -1 });
supportTicketSchema.index({ societyId: 1, createdAt: -1 });

module.exports =
  mongoose.models.SupportTicket || mongoose.model('SupportTicket', supportTicketSchema);
