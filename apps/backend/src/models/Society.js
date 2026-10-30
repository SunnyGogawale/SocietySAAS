const mongoose = require('mongoose');

const societySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

societySchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.models.Society || mongoose.model('Society', societySchema);
