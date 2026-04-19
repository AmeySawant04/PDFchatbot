#!/usr/bin/env node

/**
 * One-time migration script: Move pdfData.text from User documents
 * into the new PdfContent collection.
 *
 * Usage:
 *   node scripts/migrate-pdf-text.js              # live run
 *   node scripts/migrate-pdf-text.js --dry-run    # preview only
 *
 * Rollback:
 *   If migration fails mid-way, re-run the script — it skips sessions
 *   that already have a PdfContent document (idempotent).
 */

require("dotenv").config();
const mongoose = require("mongoose");
const userModel = require("../dbmodels/user");
const PdfContent = require("../dbmodels/pdfContent");

const DRY_RUN = process.argv.includes("--dry-run");

async function migrate() {
  const mongoUri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/PDFchatbot";

  await mongoose.connect(mongoUri);
  console.log("[Migration] Connected to MongoDB");

  if (DRY_RUN) {
    console.log("[Migration] *** DRY RUN — no data will be written ***\n");
  }

  const users = await userModel.find({});
  console.log(`[Migration] Found ${users.length} users\n`);

  let totalSessions = 0;
  let migratedSessions = 0;
  let skippedSessions = 0;
  let errorSessions = 0;

  for (const user of users) {
    if (!Array.isArray(user.session) || user.session.length === 0) continue;

    console.log(
      `[Migration] Processing user: ${user.email} (${user.session.length} sessions)`
    );

    for (const session of user.session) {
      totalSessions++;

      // Skip if session already has a pdfContent reference
      if (session.pdfContent) {
        console.log(`  [SKIP] Session ${session.sessionId} — already migrated`);
        skippedSessions++;
        continue;
      }

      // Skip if no text to migrate
      if (!session.pdfData || !session.pdfData.text) {
        console.log(
          `  [SKIP] Session ${session.sessionId} — no pdfData.text found`
        );
        skippedSessions++;
        continue;
      }

      try {
        // Check if PdfContent already exists for this session (idempotent)
        const existing = await PdfContent.findOne({
          sessionId: session.sessionId,
        });

        if (existing) {
          console.log(
            `  [SKIP] Session ${session.sessionId} — PdfContent already exists`
          );

          // Still update the user doc to add the reference if missing
          if (!DRY_RUN) {
            await userModel.updateOne(
              { _id: user._id, "session.sessionId": session.sessionId },
              {
                $set: { "session.$.pdfContent": existing._id },
                $unset: { "session.$.pdfData.text": "" },
              }
            );
          }
          skippedSessions++;
          continue;
        }

        const textLength = session.pdfData.text.length;
        console.log(
          `  [MIGRATE] Session ${session.sessionId} — text length: ${textLength} chars`
        );

        if (!DRY_RUN) {
          // 1. Create PdfContent document
          const pdfContent = await PdfContent.create({
            sessionId: session.sessionId,
            userId: user._id,
            text: session.pdfData.text,
            chunks: [],
            embeddings: "",
          });

          // 2. Update user session: add pdfContent ref, remove text
          await userModel.updateOne(
            { _id: user._id, "session.sessionId": session.sessionId },
            {
              $set: { "session.$.pdfContent": pdfContent._id },
              $unset: { "session.$.pdfData.text": "" },
            }
          );
        }

        migratedSessions++;
      } catch (err) {
        console.error(
          `  [ERROR] Session ${session.sessionId}: ${err.message}`
        );
        errorSessions++;
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  console.log("[Migration] Summary:");
  console.log(`  Total sessions:    ${totalSessions}`);
  console.log(`  Migrated:          ${migratedSessions}`);
  console.log(`  Skipped:           ${skippedSessions}`);
  console.log(`  Errors:            ${errorSessions}`);
  if (DRY_RUN) {
    console.log("\n  *** DRY RUN — no changes were made ***");
  }
  console.log("=".repeat(50));

  // ── Verification ─────────────────────────────────────────────────────────
  if (!DRY_RUN && migratedSessions > 0) {
    console.log("\n[Migration] Running verification...");
    const pdfContentCount = await PdfContent.countDocuments();
    console.log(`  PdfContent documents: ${pdfContentCount}`);

    // Spot check: pick 3 random PdfContent docs and verify they have text
    const samples = await PdfContent.aggregate([{ $sample: { size: 3 } }]);
    for (const sample of samples) {
      const hasText = sample.text && sample.text.length > 0;
      console.log(
        `  Spot check [${sample.sessionId}]: text=${hasText ? sample.text.length + " chars" : "MISSING"}`
      );
    }
  }

  await mongoose.disconnect();
  console.log("\n[Migration] Done.");
}

migrate().catch((err) => {
  console.error("[Migration] Fatal error:", err);
  process.exit(1);
});
