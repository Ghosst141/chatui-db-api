import mongoose from "mongoose";
const fileAttachmentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  size: { type: Number, required: true },
  type: { type: String, required: true },
  content: { type: String, required: true },
  lastModified: { type: Number },
}, { _id: false });


const chatSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
    },
    history: [
      {
        messageId: {
          type: mongoose.Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId()
        },
        role: {
          type: String,
          enum: ["user", "model"],
          required: true,
        },
        parts: [
          {
            text: {
              type: String,
              required: false, // Allow empty text when files are present
              default: "",
            },
          },
        ],
        files: {
          type: [fileAttachmentSchema],
          required: false,
        },
        timestamp: {
          type: Date,
          default: Date.now, // Each message gets its own timestamp
        },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.models.chat || mongoose.model("chat", chatSchema);
