import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import os from "os";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  console.log("GET /health hit");
  res.json({ ok: true });
});

const uploadDir = path.join(os.tmpdir(), "scribeo-uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/transcribe", upload.single("file"), async (req, res) => {
  console.log("\n--- NEW TRANSCRIBE REQUEST ---");

  try {
    if (!req.file) {
      console.log("No file uploaded");
      return res.status(400).json({ error: "No file uploaded" });
    }

    const filePath = req.file.path;
    console.log("Uploaded file path:", filePath);
    console.log("Original filename:", req.file.originalname);
    console.log("Mime type:", req.file.mimetype);
    console.log("File size:", req.file.size);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "gpt-4o-transcribe",
    });

    console.log("Transcription completed");
    console.log("Transcript preview:", transcription.text?.slice(0, 120) ?? "No text");

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({
      transcript: transcription.text ?? "",
    });
  } catch (error) {
    console.error("Transcription error:", error);

    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({
      error: "Transcription failed",
      details: error?.message ?? "Unknown error"
    });
  }
});

app.post("/summarize", async (req, res) => {
  console.log("\n--- NEW SUMMARY REQUEST ---");

  try {
    const { transcript } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    console.log("Transcript length:", transcript.length);
    console.time("Summary time");

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Summarize meetings into JSON with keys: summary, decisions, followUps, and actionItems. actionItems must be an array of objects with text and owner."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: transcript
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "meeting_summary",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              decisions: {
                type: "array",
                items: { type: "string" }
              },
              followUps: {
                type: "array",
                items: { type: "string" }
              },
              actionItems: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    text: { type: "string" },
                    owner: { type: ["string", "null"] }
                  },
                  required: ["text", "owner"]
                }
              }
            },
            required: ["summary", "decisions", "followUps", "actionItems"]
          }
        }
      }
    });

    console.timeEnd("Summary time");
    console.log("Summary done");

    const result = JSON.parse(response.output_text);

    res.json(result);
  } catch (error) {
    console.error("Summary error:", error);
    res.status(500).json({ error: "Summary failed" });
  }
});

app.post("/ask", async (req, res) => {
  console.log("\n--- NEW ASK REQUEST ---");

  try {
    const { question, context } = req.body;

    if (!question || !context) {
      return res.status(400).json({ error: "Question and context are required" });
    }

    console.log("Question:", question);
    console.time("Ask time");

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: "Answer questions based only on the provided meeting history."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Context:\n${context}\n\nQuestion:\n${question}`
            }
          ]
        }
      ]
    });

    console.timeEnd("Ask time");
    console.log("Ask completed");

    res.json({
      answer: response.output_text
    });
  } catch (error) {
    console.error("Ask error:", error);
    res.status(500).json({ error: "Ask failed" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});