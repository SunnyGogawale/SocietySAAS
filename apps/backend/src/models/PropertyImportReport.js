const mongoose = require('mongoose');

const propertyImportReportSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    importType: {
      type: String,
      enum: ['properties', 'residents'],
      required: true,
      immutable: true,
    },
    createdCount: { type: Number, required: true, min: 0, immutable: true },
    rowErrors: {
      type: [
        {
          row: { type: Number, required: true },
          identifier: { type: String, default: '' },
          message: { type: String, required: true },
        },
      ],
      default: [],
      immutable: true,
    },
  },
  { timestamps: true, versionKey: false },
);

propertyImportReportSchema.index({ societyId: 1, createdAt: -1 });

module.exports =
  mongoose.models.PropertyImportReport ||
  mongoose.model('PropertyImportReport', propertyImportReportSchema);
