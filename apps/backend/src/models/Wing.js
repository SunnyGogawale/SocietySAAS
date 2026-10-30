const mongoose = require('mongoose');

const wingSchema = new mongoose.Schema(
  {
    societyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: true,
      immutable: true,
    },
    buildingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Building',
      required: true,
      immutable: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true, versionKey: false },
);

wingSchema.index({ societyId: 1, buildingId: 1, code: 1 }, { unique: true });

module.exports = mongoose.models.Wing || mongoose.model('Wing', wingSchema);
