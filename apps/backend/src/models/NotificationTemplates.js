const mongoose = require('mongoose');

const templateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, maxlength: 64 },
    channel: { type: String, enum: ['email', 'sms', 'push'], required: true },
    subject: { type: String, trim: true, maxlength: 160, default: '' },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    enabled: { type: Boolean, required: true, default: true },
  },
  { _id: false },
);

const notificationTemplatesSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    templates: { type: [templateSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, versionKey: false },
);

notificationTemplatesSchema.index({ societyId: 1 }, { unique: true });

module.exports =
  mongoose.models.NotificationTemplates ||
  mongoose.model('NotificationTemplates', notificationTemplatesSchema);
