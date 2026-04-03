const pool = require("../db");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
const { STATUS } = require("../config/serverConstants");
const { DateTime } = require("luxon");
const { decryptCaseField } = require("../utils/Encryptor");

const generateCaseReport = async ({ case_ids, connection = pool }) => {
  if (!Array.isArray(case_ids)) case_ids = [case_ids];

  const [case_rows] = await connection.query(
    `
    SELECT cc.case_id, cc.notes, cc.outcome, s.name AS status_name, s.id AS status_id, client.given_name,
           client.middle_name, client.last_name,
           c.name AS course, client.public_id, client.contact_number,
           client.year_level, cc.assessment, rci.reason,
           rci.section, DATE_FORMAT(client.birthdate, '%Y-%m-%d %H:%i:%s') AS birthdate, client.gender,
           r.type, r.referred_by
    FROM counseling_cases AS cc
	  JOIN counseling_requests AS r ON r.reference_id = cc.request_reference_id
    JOIN users AS client ON client.account_id = r.client_id
    LEFT JOIN request_client_informations AS rci ON rci.request_reference_id = r.reference_id
	  LEFT JOIN courses AS c ON c.id = client.course
    LEFT JOIN status AS s ON s.id = cc.status
    WHERE cc.case_id IN (?)
    `,
    [case_ids],
  );

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const sessions = await generateSessionReport({ case_ids, browser });
  const intake = await generateIntakeQuestionnaireReport({ case_ids, browser });

  const case_buffers = [];

  for (const c of case_rows) {
    const fullName = [c.given_name, c.middle_name, c.last_name]
      .filter(Boolean)
      .join(" ");

    const todayPh = DateTime.now().setZone("Asia/Manila");
    const birthdate = DateTime.fromSQL(c.birthdate);
    const age = todayPh.diff(birthdate, "years").years | 0;

    const html = `
      <html>
      <head>
      <meta charset="UTF-8" />

      <style>
      @page{
        size:A4;
        margin:25mm;
      }

      body{
        font-family:"Segoe UI", Arial, Helvetica, sans-serif;
        font-size:12pt;
        line-height:1.6;
        color:#111;
      }

      .header{
        text-align:center;
        margin-bottom:30px;
      }

      .header h1{
        font-size:22pt;
        margin:0;
        letter-spacing:1px;
      }

      .subtitle{
        font-size:11pt;
        color:#555;
      }

      .section{
        margin-bottom:32px;
      }

      .section-title{
        font-size:14pt;
        font-weight:bold;
        border-bottom:2px solid #333;
        padding-bottom:4px;
        margin-bottom:10px;
      }

      .meta{
        display:grid;
        grid-template-columns:180px 1fr;
        gap:6px 10px;
      }

      .meta-label{
        font-weight:bold;
      }

      .meta-value{
        border-bottom:1px solid #ddd;
        padding-bottom:2px;
      }

      .content-box{
        border:1px solid #ddd;
        padding:12px;
        min-height:120px;
        white-space:pre-wrap;
        text-align:justify;
      }

      .footer{
        position:fixed;
        bottom:15mm;
        left:0;
        right:0;
        text-align:center;
        font-size:9pt;
        color:#777;
      }

      .footer hr{
        border:none;
        border-top:1px solid #ccc;
        margin-bottom:6px;
      }
      </style>
      </head>

      <body>

      <div class="header">
        <h1>Counseling Case Report</h1>
        <div class="subtitle">Confidential Counseling Documentation</div>
      </div>

      <div class="section">
        <div class="section-title">Client Information</div>

        <div class="meta">

          <div class="meta-label">Case ID</div>
          <div class="meta-value">${c.case_id}</div>

          <div class="meta-label">Status</div>
          <div class="meta-value">${c.status_name || "Unknown"}</div>

          <div class="meta-label">Client Name</div>
          <div class="meta-value">${fullName || "N/A"}</div>

          <div class="meta-label">Gender</div>
          <div class="meta-value">${c.gender || "N/A"}</div>

          <div class="meta-label">Request type</div>
          <div class="meta-value">${c.type || "N/A"}</div>

          ${c.type === "referred" ? `<div class="meta-label">Referred by</div>
          <div class="meta-value">${c.referred_by || "N/A"}</div>` : ''}

          <div class="meta-label">Contact No.</div>
          <div class="meta-value">${c.contact_number || "N/A"}</div>

          <div class="meta-label">Age</div>
          <div class="meta-value">${age || "N/A"}</div>

          <div class="meta-label">Student ID</div>
          <div class="meta-value">${c.public_id || "N/A"}</div>

          <div class="meta-label">Course</div>
          <div class="meta-value">${c.course || "N/A"}</div>

          <div class="meta-label">Year Level</div>
          <div class="meta-value">${c.year_level || "N/A"}</div>

          <div class="meta-label">Section</div>
          <div class="meta-value">${c.section || "N/A"}</div>

          <div class="meta-label">Reason for Counseling</div>
          <div class="meta-value">${decryptCaseField(c.reason) || "Not specified"}</div>

        </div>
      </div>

      <div class="section">
        <div class="section-title">Case Notes</div>

        <div class="content-box">
      ${decryptCaseField(c.notes) || "No notes were recorded for this case."}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Counselor Assessment</div>

        <div class="content-box">
      ${decryptCaseField(c.assessment) || "No assessment was recorded."}
        </div>
      </div>

      ${
        c.status_id === STATUS.TERMINATED
          ? `
      <div class="section">
        <div class="section-title">Session Outcome</div>

        <div class="content-box">
      ${decryptCaseField(c.outcome) || "No outcome was recorded for this ongoing case."}
        </div>
      </div>
      `
          : ``
      }

      <div class="footer">
        <hr/>
        Confidential • For Counseling Use Only
      </div>

      </body>
      </html>
      `;

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf_buffer = await page.pdf({ format: "A4", printBackground: true });
    await page.close();

    case_buffers.push({
      case_id: c.case_id,
      pdf_buffer,
      sessions: sessions[c.case_id] || [],
      intake_pdf: intake[c.case_id] || null,
    });
  }

  await browser.close();

  const archive = archiver("zip", { zlib: { level: 9 } });
  const zip_chunks = [];

  archive.on("data", (chunk) => zip_chunks.push(chunk));
  archive.on("error", (err) => {
    throw err;
  });

  case_buffers.forEach(({ case_id, pdf_buffer, sessions, intake_pdf }) => {
    archive.append(Buffer.from(pdf_buffer), {
      name: `CASE_${case_id}/Case#${case_id}.pdf`,
    });

    if (intake_pdf) {
      archive.append(Buffer.from(intake_pdf), {
        name: `CASE_${case_id}/Intake_Questionnaire.pdf`,
      });
    }

    sessions.forEach(({ pdf_buffer, session_id, from }) => {
      if (!pdf_buffer) return;

      const date = new Date(from);
      const formatted_date = `${date.toLocaleString("en-US", {
        month: "short",
      })}${date.getDate()}_${date.getFullYear()}`;

      archive.append(Buffer.from(pdf_buffer), {
        name: `CASE_${case_id}/SESSION_${session_id}_${formatted_date}.pdf`,
      });
    });
  });

  archive.finalize();

  await new Promise((resolve) => archive.on("end", resolve));

  return Buffer.concat(zip_chunks);
};

const generateSessionReport = async ({
  case_ids,
  browser,
  connection = pool,
}) => {
  if (!Array.isArray(case_ids)) case_ids = [case_ids];

  const [case_rows] = await connection.query(
    `SELECT ccs.session_id, ccs.\`from\`, ccs.notes, ccs.case_id, ccs.assessment, ccs.intervention_plan, 
            s.name AS status_name, s.id AS status_id, ccs.outcome, ccs.session_type, ctp.name AS mode
     FROM counseling_case_sessions AS ccs
     LEFT JOIN counseling_type AS ctp ON ctp.id = ccs.mode
     LEFT JOIN status AS s ON s.id = ccs.status
     WHERE ccs.case_id IN (?)`,
    [case_ids],
  );

  const session_buffers = {};

  for (const c of case_rows) {
    const html = `
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          @page { size: A4; margin: 25mm; }
          body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; line-height: 1.5; color: #000; }
          h1, h2 { text-align: center; margin-bottom: 15px; }
          h1 { font-size: 18pt; letter-spacing: 0.5px; }
          h2 { font-size: 14pt; }
          .meta, .section { margin-bottom: 25px; }
          .meta-row { display: table; width: 100%; margin-bottom: 8px; }
          .meta-label { display: table-cell; width: 160px; font-weight: bold; vertical-align: top; }
          .meta-value { display: table-cell; }
          .section-title { font-weight: bold; font-size: 13pt; margin-bottom: 8px; border-bottom: 1px solid #444; padding-bottom: 3px; }
          .content-box { white-space: pre-wrap; text-align: justify; border: 1px solid #ccc; padding: 10px; background-color: #f9f9f9; }
          .footer { position: fixed; bottom: 20mm; left: 0; right: 0; text-align: center; font-size: 9pt; color: #666; }
        </style>
      </head>
      <body>
        <h1>Session Report</h1>

        <div class="meta">
          <div class="meta-row">
            <div class="meta-label">Case ID:</div>
            <div class="meta-value">${c.case_id}</div>
          </div>

          <div class="meta-row">
            <div class="meta-label">Session ID:</div>
            <div class="meta-value">${c.session_id}</div>
          </div>

           <div class="meta-row">
            <div class="meta-label">Session Type:</div>
            <div class="meta-value">${c.session_type}</div>
          </div>

             <div class="meta-row">
            <div class="meta-label">Mode:</div>
            <div class="meta-value">${c.mode}</div>
          </div>

          <div class="meta-row">
            <div class="meta-label">Date:</div>
            <div class="meta-value">${new Date(c.from).toLocaleDateString()}</div>
          </div>

          <div class="meta-row">
            <div class="meta-label">Status:</div>
            <div class="meta-value">${c.status_name || "Unknown"}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Notes</div>
          <div class="content-box">
            ${decryptCaseField(c.notes) || "No notes were recorded for this session."}
          </div>
        </div>

        <div class="section">
          <div class="section-title">Assessment</div>
          <div class="content-box">
            ${decryptCaseField(c.assessment) || "No assessment was recorded for this session."}
          </div>
        </div>

        <div class="section">
          <div class="section-title">Intervention Plan</div>
          <div class="content-box">
            ${decryptCaseField(c.intervention_plan) || "No intervention plan was recorded for this session."}
          </div>
        </div>

        ${
          c.status_id === STATUS.TERMINATED
            ? `
          <div class="section">
            <div class="section-title">Session Outcome</div>
            <div class="content-box">
              ${c.outcome || "No outcome was recorded for this ongoing session."}
            </div>
          </div>
          `
            : ``
        }

        <div class="footer">
          Confidential • For Counseling Use Only
        </div>
      </body>
      </html>
      `;

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf_buffer = await page.pdf({ format: "A4", printBackground: true });
    await page.close();

    if (!session_buffers[c.case_id]) session_buffers[c.case_id] = [];
    session_buffers[c.case_id].push({
      pdf_buffer,
      session_id: c.session_id,
      from: c.from,
    });
  }

  return session_buffers;
};

const generateIntakeQuestionnaireReport = async ({
  case_ids,
  browser,
  connection = pool,
}) => {
  if (!Array.isArray(case_ids)) case_ids = [case_ids];

  const [question_rows] = await connection.query(
    `
      SELECT 
        qa.question,
        qa.answer,
        client.given_name,
        client.middle_name,
        client.last_name,
        cc.case_id
      FROM counseling_request_questionaire_answers AS qa
      JOIN counseling_cases AS cc 
        ON cc.request_reference_id = qa.request_reference_id
      JOIN counseling_requests AS cr 
        ON cr.reference_id = cc.request_reference_id
      JOIN users AS client 
        ON client.account_id = cr.client_id
      WHERE cc.case_id IN (?)
    `,
    [case_ids],
  );

  const case_answer_sheet = {};

  question_rows.forEach((q) => {
    if (!case_answer_sheet[q.case_id]) {
      case_answer_sheet[q.case_id] = {
        case_id: q.case_id,
        client: {
          given_name: q.given_name,
          middle_name: q.middle_name,
          last_name: q.last_name,
        },
        questions: [],
      };
    }

    case_answer_sheet[q.case_id].questions.push({
      question: q.question,
      answer: q.answer,
    });
  });

  const intake_buffers = {};

  for (const case_id of Object.keys(case_answer_sheet)) {
    const c = case_answer_sheet[case_id];

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            @page {
              size: A4;
              margin: 20mm;
            }

            body {
              font-family: Arial, Helvetica, sans-serif;
              font-size: 11pt;
              color: #202124;
              background: #fff;
            }

            h1 {
              text-align: center;
              font-size: 18pt;
              margin-bottom: 10px;
            }

            .subtitle {
              text-align: center;
              font-size: 10pt;
              color: #5f6368;
              margin-bottom: 25px;
            }

            .meta {
              margin-bottom: 30px;
            }

            .meta div {
              margin-bottom: 6px;
            }

            .label {
              font-weight: bold;
            }

            .question-block {
              margin-bottom: 20px;
              padding-bottom: 12px;
              border-bottom: 1px solid #dadce0;
            }

            .question {
              font-weight: bold;
              margin-bottom: 6px;
            }

            .answer {
              padding: 8px 10px;
              background: #f8f9fa;
              border-radius: 4px;
              white-space: pre-wrap;
            }

            .footer {
              position: fixed;
              bottom: 15mm;
              left: 0;
              right: 0;
              text-align: center;
              font-size: 9pt;
              color: #70757a;
            }
          </style>
        </head>

        <body>
          <h1>Intake Questionnaire</h1>
          <div class="subtitle">Confidential Counseling Record</div>

          <div class="meta">
            <div><span class="label">Case ID:</span> ${c.case_id}</div>
            <div>
              <span class="label">Client Name:</span>
              ${c.client.given_name}
              ${c.client.middle_name || ""}
              ${c.client.last_name}
            </div>
          </div>

          ${c.questions
            .map(
              (q, i) => `
                <div class="question-block">
                  <div class="question">${i + 1}. ${q.question}</div>
                  <div class="answer">${decryptCaseField(q.answer) || "—"}</div>
                </div>
              `,
            )
            .join("")}

          <div class="footer">
            Confidential • For Counseling Use Only
          </div>
        </body>
      </html>
    `;

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf_buffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });
    await page.close();

    intake_buffers[case_id] = pdf_buffer;
  }

  return intake_buffers;
};

module.exports = { generateCaseReport };
