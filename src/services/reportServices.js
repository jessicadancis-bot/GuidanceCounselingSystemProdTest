const pool = require("../db");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
const { STATUS } = require("../config/serverConstants");
const { DateTime } = require("luxon");
const { decryptCaseField } = require("../utils/Encryptor");
const { escapeHTML } = require("../utils/htmlHelper");

const generateCaseReport = async ({ case_ids, connection = pool }) => {
  if (!Array.isArray(case_ids)) case_ids = [case_ids];

  const [case_rows] = await connection.query(
    `
    SELECT cc.case_id, cc.notes, cc.outcome, s.name AS status_name, s.id AS status_id, client.given_name,
           client.middle_name, client.last_name, client.contact_number, acc.email,
           c.name AS course, client.public_id,
           client.year_level, cc.assessment, rci.reason,
           rci.section, DATE_FORMAT(client.birthdate, '%Y-%m-%d %H:%i:%s') AS birthdate, client.gender,
           r.type, r.referred_by
    FROM counseling_cases AS cc
    JOIN counseling_requests AS r ON r.reference_id = cc.request_reference_id
    JOIN users AS client ON client.account_id = r.client_id
    JOIN accounts AS acc ON acc.account_id = r.client_id
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

    const birthdateObj = DateTime.fromSQL(c.birthdate, { zone: "Asia/Manila" });
    const birthdateFormatted = birthdateObj.isValid
      ? birthdateObj.toFormat("MMMM dd, yyyy")
      : "";

    const age = birthdateObj.isValid
      ? Math.floor(todayPh.diff(birthdateObj, "years").years)
      : "";

    const html = `
      <html>
      <head>
      <meta charset="UTF-8" />
       <style>
        @page {
          size: A4;
          margin: 15mm 20mm;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: Arial, Helvetica, sans-serif;
          font-size: 10pt;
          color: #000;
          background: #fff;
        }

        .page-header {
          display: flex;
          align-items: center;
          padding-bottom: 6px;
        }

        .header-left {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .header-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .header-line {
          border: none;
          height: 3px;
          background-color: #2e6b2e;
          margin: 0 0 10px 0;
        }

        .logo-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .logo-img {
          width: 52px;
          height: 52px;
          object-fit: contain;
        }

        .logo-divider {
          width: 3px;
          align-self: stretch;
          background-color: #2e6b2e;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .institution-info {
          text-align: center;
          flex: 1;
        }

        .institution-info .republic {
          font-size: 8pt;
          color: #333;
        }

        .institution-info .college-name {
          font-size: 11pt;
          font-weight: bold;
          letter-spacing: 0.5px;
        }

        .institution-info .office-name {
          font-size: 8pt;
          color: #333;
        }

        .form-ref {
          font-size: 7.5pt;
          text-align: right;
          color: #333;
          line-height: 1.5;
          flex-shrink: 0;
        }

        .report-title {
          text-align: center;
          font-size: 13pt;
          font-weight: bold;
          letter-spacing: 0.5px;
          margin: 8px 0;
          text-decoration: underline;
        }
        .client-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }

        .client-table th {
          background-color: #2e6b2e;
          color: #fff;
          text-align: left;
          padding: 5px 8px;
          font-size: 10pt;
          font-weight: bold;
          letter-spacing: 0.5px;
        }

        .client-table td {
          border: 1px solid #999;
          padding: 5px 8px;
          vertical-align: top;
          font-size: 9.5pt;
        }

        .client-table .label {
          font-weight: bold;
        }

        .field-value {
          border-bottom: 1px solid #555;
          display: inline-block;
          min-width: 140px;
          padding-bottom: 1px;
        }

        .mode-cell {
          vertical-align: top;
        }

        .checkbox-row {
          display: flex;
          align-items: flex-start;
          gap: 4px;
          margin-bottom: 3px;
          font-size: 9pt;
        }

        .checkbox {
          width: 10px;
          height: 10px;
          border: 1px solid #333;
          display: inline-block;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .checkbox.checked {
          background: #000;
        }

        .section {
          margin-bottom: 10px;
        }

        .section-label {
          font-weight: bold;
          font-size: 10pt;
          margin-bottom: 4px;
        }

        .section-body {
          font-size: 9.5pt;
          min-height: 18px;
          padding: 2px 0;
          white-space: pre-wrap;
          text-align: justify;
        }

        .case-formulation {
          margin-bottom: 10px;
        }

        .cf-item {
          margin-bottom: 8px;
          font-size: 9.5pt;
          text-align: justify;
        }

        .cf-item .cf-title {
          font-weight: bold;
        }

        .cf-content {
          margin-left: 20px;
          margin-top: 3px;
          min-height: 16px;
          white-space: pre-wrap;
        }

        .status-badge {
          display: inline-block;
          background-color: #2e6b2e;
          color: #fff;
          padding: 2px 10px;
          font-size: 9pt;
          font-weight: bold;
          border-radius: 2px;
          margin-top: 4px;
        }

        .sig-block {
          display: flex;
          justify-content: space-between;
          margin-top: 24px;
          font-size: 9.5pt;
        }

        .sig-col {
          width: 45%;
        }

        .sig-col .sig-label {
          margin-bottom: 20px;
        }

        .sig-col .sig-name {
          font-weight: bold;
          border-top: 1px solid #333;
          padding-top: 3px;
          margin-top: 2px;
        }

        .sig-col .sig-title {
          font-size: 9pt;
        }

        .footer {
          position: fixed;
          bottom: 10mm;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 7.5pt;
          color: #555;
        }

        .confidential-stamp {
          position: fixed;
          top: 50mm;
          left: 50%;
          transform: translateX(-50%) rotate(-30deg);
          font-size: 52pt;
          font-weight: bold;
          color: rgba(180,200,180,0.18);
          letter-spacing: 6px;
          pointer-events: none;
          white-space: nowrap;
        }

        hr.thin {
          border: none;
          border-top: 1px solid #aaa;
          margin: 6px 0;
        }
      </style>
      </head>
      <body>

      <div class="confidential-stamp">CONFIDENTIAL</div>

      <div class="page-header">
        <div class="header-left">
          <div class="logo-group">
            <img src="assests/images/bagongpilipinas.png" alt="Bagong Pilipinas" class="logo-img">
            <img src="assests/images/tagaytaycityseal.png" alt="City Seal" class="logo-img">
            <img src="assests/images/counselinglogo.png" alt="Counseling Logo" class="logo-img">
            <img src="assests/images/citycollegelogo.png" alt="CCT Logo" class="logo-img">
          </div>
        </div>
        <div class="logo-divider"></div>
        <div class="header-right">
          <div class="institution-info">
            <div class="republic">Republic of the Philippines<br>City of Tagaytay</div>
            <div class="college-name">CITY COLLEGE OF TAGAYTAY</div>
            <div class="office-name">Guidance, Counseling, Appraisal, and Psychological Services</div>
          </div>
        </div>
      </div>

      <hr class="header-line">

      <div class="form-ref">
        <strong>Case ID:</strong> ${escapeHTML(c.case_id || "N/A")}
        <br>OSES-GCAPC-FORM-016<br>REV02102025kbrgs
      </div>

      <div class="report-title">COUNSELING CASE REPORT</div>

      <table class="client-table">
        <tr>
          <th colspan="2">CLIENT INFORMATION</th>
        </tr>
        <tr>
          <td><span class="label">Name:</span>
          <span class="field-value" style="min-width:220px;">${escapeHTML(fullName)}</span></td>
          <td><span class="label">Student ID:</span>
          <span class="field-value">${escapeHTML(c.public_id)}</span></td>
        </tr>
        <tr>
          <td><span class="label">Program:</span>
          <span class="field-value">${escapeHTML(c.course)}</span></td>
          <td>
            <span class="label">Section:</span>
            <span class="field-value">${escapeHTML(c.section || "")}</span>

            <span class="label">Age:</span>
            <span class="field-value">${escapeHTML(age)}</span>

            <span class="label">Birthdate:</span>
            <span class="field-value">${escapeHTML(birthdateFormatted)}</span>
          </td>
        </tr>
        <tr>
          <td><span class="label">Gender:</span>
          <span class="field-value">${escapeHTML(c.gender)}</span></td>
          <td>
            <span class="label">Contact No:</span>
            <span class="field-value">${escapeHTML(c.contact_number || "")}</span>

            <span class="label">Email:</span>
            <span class="field-value">${escapeHTML(c.email || "")}</span>
          </td>
        </tr>
      </table>

      <div class="section">
        <div class="section-label">Case Notes</div>
        <div class="section-body">
          ${escapeHTML(decryptCaseField(c.notes) || "No notes were recorded for this case.")}
        </div>
      </div>

      <hr class="thin">

      <div class="section">
        <div class="section-label">Counselor Assessment</div>
        <div class="section-body">
          ${escapeHTML(decryptCaseField(c.assessment) || "No assessment was recorded.")}
        </div>
      </div>

      <hr class="thin">

      <div class="section">
        <div class="section-label">CLIENT STATUS</div>
        <div>
          <span class="status-badge">${escapeHTML(c.status_name || "Unknown")}</span>
        </div>
      </div>

      ${
        c.status_id === STATUS.TERMINATED
          ? `
      <div class="section">
        <div class="section-label">Session Outcome</div>
        <div class="section-body">
          ${escapeHTML(decryptCaseField(c.outcome) || "No outcome was recorded.")}
        </div>
      </div>
      `
          : ``
      }

      <div class="sig-block">
        <div class="sig-col">
          <div class="sig-label">Prepared by</div>
          <br><br>
          <div class="sig-name">&nbsp;</div>
          <div class="sig-title">School Counselor</div>
        </div>
        <div class="sig-col" style="text-align:right;">
          <div class="sig-label">Noted by</div>
          <br><br>
          <div class="sig-name">Ma. Kimberlei Fae I. Besmont, RGC</div>
          <div class="sig-title">Guidance Director</div>
        </div>
      </div>

      <div class="footer">
        <em>Counseling Case Report 2026.docx</em>
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
    const dateObj = DateTime.fromJSDate(new Date(c.from), {
      zone: "Asia/Manila",
    });

    const formattedDate = dateObj.isValid
      ? dateObj.toFormat("MMMM dd, yyyy")
      : "";

    const html = `
    <html>
      <head>
      <meta charset="UTF-8" />
       <style>
        @page {
          size: A4;
          margin: 15mm 20mm;
        }

        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: Arial, Helvetica, sans-serif;
          font-size: 10pt;
          color: #000;
          background: #fff;
        }
        .page-header {
          display: flex;
          align-items: center;
          padding-bottom: 6px;
        }

        .header-left {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .header-right {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .header-line {
          border: none;
          height: 3px;
          background-color: #2e6b2e;
          margin: 0 0 10px 0;
        }

        .logo-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .logo-img {
          width: 52px;
          height: 52px;
          object-fit: contain;
        }

        .logo-divider {
          width: 3px;
          align-self: stretch;
          background-color: #2e6b2e;
          border-radius: 2px;
          flex-shrink: 0;
        }

        .institution-info {
          text-align: center;
          flex: 1;
        }

        .institution-info .republic {
          font-size: 8pt;
          color: #333;
        }

        .institution-info .college-name {
          font-size: 11pt;
          font-weight: bold;
          letter-spacing: 0.5px;
        }

        .institution-info .office-name {
          font-size: 8pt;
          color: #333;
        }

        .form-ref {
          font-size: 7.5pt;
          text-align: right;
          color: #333;
          line-height: 1.5;
          flex-shrink: 0;
        }

        .report-title {
          text-align: center;
          font-size: 13pt;
          font-weight: bold;
          letter-spacing: 0.5px;
          margin: 8px 0;
          text-decoration: underline;
        }
        .client-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }

        .client-table th {
          background-color: #2e6b2e;
          color: #fff;
          text-align: left;
          padding: 5px 8px;
          font-size: 10pt;
          font-weight: bold;
          letter-spacing: 0.5px;
        }

        .client-table td {
          border: 1px solid #999;
          padding: 5px 8px;
          vertical-align: top;
          font-size: 9.5pt;
        }

        .client-table .label {
          font-weight: bold;
        }

        .field-value {
          border-bottom: 1px solid #555;
          display: inline-block;
          min-width: 140px;
          padding-bottom: 1px;
        }

        .checkbox-row {
          display: flex;
          align-items: flex-start;
          gap: 4px;
          margin-bottom: 3px;
          font-size: 9pt;
        }

        .checkbox {
          width: 10px;
          height: 10px;
          border: 1px solid #333;
          display: inline-block;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .checkbox.checked {
          background: #000;
        }
        .section {
          margin-bottom: 10px;
        }

        .section-label {
          font-weight: bold;
          font-size: 10pt;
          margin-bottom: 4px;
        }

        .section-body {
          font-size: 9.5pt;
          min-height: 18px;
          padding: 2px 0;
          white-space: pre-wrap;
          text-align: justify;
        }
        .status-badge {
          display: inline-block;
          background-color: #2e6b2e;
          color: #fff;
          padding: 2px 10px;
          font-size: 9pt;
          font-weight: bold;
          border-radius: 2px;
          margin-top: 4px;
        }

        .sig-block {
          display: flex;
          justify-content: space-between;
          margin-top: 24px;
          font-size: 9.5pt;
        }

        .sig-col {
          width: 45%;
        }

        .sig-col .sig-label {
          margin-bottom: 20px;
        }

        .sig-col .sig-name {
          font-weight: bold;
          border-top: 1px solid #333;
          padding-top: 3px;
          margin-top: 2px;
        }

        .sig-col .sig-title {
          font-size: 9pt;
        }
        .footer {
          position: fixed;
          bottom: 10mm;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 7.5pt;
          color: #555;
        }

        .confidential-stamp {
          position: fixed;
          top: 50mm;
          left: 50%;
          transform: translateX(-50%) rotate(-30deg);
          font-size: 52pt;
          font-weight: bold;
          color: rgba(180,200,180,0.18);
          letter-spacing: 6px;
          pointer-events: none;
          white-space: nowrap;
        }

        hr.thin {
          border: none;
          border-top: 1px solid #aaa;
          margin: 6px 0;
        }
      </style>
      </head>
      <body>

      <div class="confidential-stamp">CONFIDENTIAL</div>

     <div class="page-header">
        <div class="header-left">
          <div class="logo-group">
            <img src="assests/images/bagongpilipinas.png" alt="Bagong Pilipinas" class="logo-img">
            <img src="assests/images/tagaytaycityseal.png" alt="City Seal" class="logo-img">
            <img src="assests/images/counselinglogo.png" alt="Counseling Logo" class="logo-img">
            <img src="assests/images/citycollegelogo.png" alt="CCT Logo" class="logo-img">
          </div>
        </div>
        <div class="logo-divider"></div>
        <div class="header-right">
          <div class="institution-info">
            <div class="republic">Republic of the Philippines<br>City of Tagaytay</div>
            <div class="college-name">CITY COLLEGE OF TAGAYTAY</div>
            <div class="office-name">Guidance, Counseling, Appraisal, and Psychological Services</div>
          </div>
        </div>
      </div>

      <hr class="header-line">

      <div class="form-ref">
        <strong>Session ID:</strong> ${escapeHTML(c.session_id || "N/A")}
        <br>CGCAPS-FORM-025<br>REV0220126kbrgs
      </div>

      <div class="report-title">COUNSELING SESSION REPORT</div>

      <table class="client-table">
        <tr>
          <th colspan="2">CLIENT INFORMATION</th>
        </tr>
        <tr>
          <td style="width:50%">
            <span class="label">Date of Counseling:</span><br>
            <span class="field-value">${escapeHTML(formattedDate)}</span>
          </td>
          <td style="width:50%">
            <span class="label">Session:</span>
            <span style="margin-left:6px;">
              ${escapeHTML(c.session_type || "")}
            </span>

            <span class="label">Mode:</span>
            <span style="margin-left:6px;">
              ${escapeHTML(c.mode || "")}
            </span>
          </td>
        </tr>
      </table>

      <div class="section">
        <div class="section-label">Notes</div>
        <div class="section-body">
          ${escapeHTML(decryptCaseField(c.notes) || "No notes were recorded for this session.")}
        </div>
      </div>

      <hr class="thin">

      <div class="section">
        <div class="section-label">Assessment</div>
        <div class="section-body">
          ${escapeHTML(decryptCaseField(c.assessment) || "No assessment was recorded for this session.")}
        </div>
      </div>

      <hr class="thin">

      <div class="section">
        <div class="section-label">Intervention Plan</div>
        <div class="section-body">
          ${escapeHTML(decryptCaseField(c.intervention_plan) || "No intervention plan was recorded for this session.")}
        </div>
      </div>

      <hr class="thin">

      <div class="section">
        <div class="section-label">CLIENT STATUS</div>
        <div>
          <span class="status-badge">${escapeHTML(c.status_name || "Unknown")}</span>
        </div>
      </div>

      ${
        c.status_id === STATUS.TERMINATED
          ? `
      <div class="section">
        <div class="section-label">Session Outcome</div>
        <div class="section-body">
          ${escapeHTML(decryptCaseField(c.outcome) || "No outcome was recorded for this session.")}
        </div>
      </div>
      `
          : ``
      }

      <div class="sig-block">
        <div class="sig-col">
          <div class="sig-label">Prepared by</div>
          <br><br>
          <div class="sig-name">&nbsp;</div>
          <div class="sig-title">School Counselor</div>
        </div>

        <div class="sig-col" style="text-align:right;">
          <div class="sig-label">Noted by</div>
          <br><br>
          <div class="sig-name">Ma. Kimberlei Fae I. Besmont, RGC</div>
          <div class="sig-title">Guidance Director</div>
        </div>
      </div>

      <div class="footer">
        <em>Counseling Session Report 2025.docx</em>
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
    [case_ids]
  );

  const case_answer_sheet = {};

  // Organize questions per case
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
            @page { size: A4; margin: 20mm; }
            body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #202124; background: #fff; }
            h1 { text-align: center; font-size: 18pt; margin-bottom: 10px; }
            .subtitle { text-align: center; font-size: 10pt; color: #5f6368; margin-bottom: 25px; }
            .meta { margin-bottom: 30px; }
            .meta div { margin-bottom: 6px; }
            .label { font-weight: bold; }
            .question-block { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #dadce0; }
            .question { font-weight: bold; margin-bottom: 6px; }
            .answer { padding: 8px 10px; background: #f8f9fa; border-radius: 4px; white-space: pre-wrap; }
            .footer { position: fixed; bottom: 15mm; left: 0; right: 0; text-align: center; font-size: 9pt; color: #70757a; }
          </style>
        </head>
        <body>
          <h1>Intake Questionnaire</h1>
          <div class="subtitle">Confidential Counseling Record</div>

          <div class="meta">
            <div><span class="label">Case ID:</span> ${escapeHTML(c.case_id)}</div>
            <div>
              <span class="label">Client Name:</span>
              ${escapeHTML(c.client.given_name)}
              ${escapeHTML(c.client.middle_name || "")}
              ${escapeHTML(c.client.last_name)}
            </div>
          </div>

          ${c.questions
            .map(
              (q, i) => `
                <div class="question-block">
                  <div class="question">${i + 1}. ${escapeHTML(q.question)}</div>
                  <div class="answer">${escapeHTML(decryptCaseField(q.answer) || "—")}</div>
                </div>
              `
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
