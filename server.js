import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  console.log("GET /health hit");
  res.json({ ok: true });
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || ".m4a";
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const upload = multer({ storage });

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

    console.log("File received:", req.file.path);
    console.log("Original name:", req.file.originalname);
    console.log("MIME type:", req.file.mimetype);

    console.time("Transcription time");

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "gpt-4o-transcribe",
    });

    console.timeEnd("Transcription time");
    console.log("Transcription done");

    fs.unlinkSync(req.file.path);

    res.json({
      transcript: transcription.text,
    });
  } catch (error) {
    console.error("Transcription error:", error);
    res.status(500).json({ error: "Transcription failed" });
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