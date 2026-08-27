import { formatNumber } from "../utils";
import type { FamilyMonthlyReport, MedicalSessionNote, ReportSection } from "./types";
import { DOMAIN_STATUS_LABELS } from "./types";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSectionTable(section: ReportSection): string {
  const { label, tickets: rows, count, truncated, subcategories } = section;
  if (!count) return "";

  const subcategoryBlocks =
    (subcategories ?? []).length > 1
      ? (subcategories ?? [])
          .map((group) => {
            const body = group.tickets
              .map(
                (r) => `
        <tr>
          <td class="col-date">${escapeHtml(r.date)}</td>
          <td class="col-summary">${escapeHtml(r.summary)}</td>
        </tr>`
              )
              .join("");
            return `
      <h4 class="subcategory-title">${escapeHtml(group.subCategory)} <span class="count">(${group.count})</span></h4>
      <table>
        <thead><tr><th>Date</th><th>Service</th></tr></thead>
        <tbody>${body}</tbody>
      </table>`;
          })
          .join("")
      : "";

  const flatBody = rows
    .map(
      (r) => `
        <tr>
          <td class="col-date">${escapeHtml(r.date)}</td>
          <td class="col-summary">${escapeHtml(r.summary)}</td>
        </tr>`
    )
    .join("");

  const truncNote = truncated
    ? `<p class="empty truncated-note">Showing ${rows.length} of ${count} entries.</p>`
    : "";

  const tableContent =
    (subcategories ?? []).length > 1
      ? subcategoryBlocks
      : `<table>
        <thead><tr><th>Date</th><th>Service</th></tr></thead>
        <tbody>${flatBody}</tbody>
      </table>`;

  return `
    <section class="report-section">
      <h3>${escapeHtml(label)} <span class="count">(${count})</span></h3>
      ${tableContent}
      ${truncNote}
    </section>`;
}

function renderMedicalSessions(sessions: MedicalSessionNote[] | undefined): string {
  const list = sessions ?? [];
  const nonPhysio = list.filter(
    (s) =>
      !/physio|physiotherap/i.test(
        `${s.subCategory ?? ""} ${s.category ?? ""} ${s.sessionTitle ?? ""}`
      )
  );

  if (!nonPhysio.length) {
    return `<p class="empty">No closed doctor or wellness tickets this month.</p>`;
  }

  const rows = nonPhysio
    .map(
      (s) => `
      <tr>
        <td class="col-date">${escapeHtml(s.dateLabel)}</td>
        <td class="col-practitioner">${escapeHtml(s.practitioner ?? "—")}</td>
        <td class="col-service">${escapeHtml(s.sessionTitle || s.service)}</td>
        <td class="col-notes pre-wrap">${escapeHtml(s.notes || "—")}</td>
      </tr>`
    )
    .join("");

  return `
    <section class="report-section">
      <h3>Doctor &amp; wellness session log <span class="count">(${nonPhysio.length})</span></h3>
      <p class="section-lead">Closed doctor, consultant, and wellness tickets — insight notes are pulled from each ticket’s HubSpot Notes tab.</p>
      <table class="medical-log">
        <thead>
          <tr>
            <th>Date</th>
            <th>Clinician</th>
            <th>Session</th>
            <th>Insight notes (HubSpot ticket Notes tab)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderPhysioSessions(sessions: MedicalSessionNote[] | undefined): string {
  const list = sessions ?? [];
  if (!list.length) {
    return `<p class="empty">No physiotherapy sessions recorded this month.</p>`;
  }

  const rows = list
    .map(
      (s) => `
      <tr>
        <td class="col-date">${escapeHtml(s.dateLabel)}</td>
        <td class="col-patient">${escapeHtml(s.beneficiaryHint ?? "—")}</td>
        <td class="col-practitioner">${escapeHtml(s.practitioner ?? "—")}</td>
        <td class="col-service">${escapeHtml(s.sessionTitle || s.service)}</td>
        <td class="col-notes pre-wrap">${escapeHtml(s.notes || "—")}</td>
      </tr>`
    )
    .join("");

  return `
    <section class="report-section physio-section">
      <h3>Physiotherapy sessions <span class="count">(${list.length})</span></h3>
      <p class="section-lead">Each row is a closed HubSpot physio ticket for this family — session title, clinician, and insight notes from the ticket Notes tab (plus any session summary in the ticket body).</p>
      <table class="medical-log physio-log">
        <thead>
          <tr>
            <th>Date</th>
            <th>Patient</th>
            <th>Physio / clinician</th>
            <th>Session</th>
            <th>Progress notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderClinicalAnalysis(report: FamilyMonthlyReport): string {
  const a = report.clinicalAnalysis;
  if (!a || a.sessionCount === 0) return "";

  const trajectoryClass = `trajectory-${a.trajectory}`;
  const insights =
    a.insights.length > 0
      ? `<ul class="insight-list">
        ${a.insights
          .map(
            (i) => `
          <li class="insight-${i.signal}">
            <span class="milestone-date">${escapeHtml(i.dateLabel)}</span>
            ${i.practitioner ? `<strong>${escapeHtml(i.practitioner)}</strong> · ` : ""}
            ${escapeHtml(i.summary)}
            <span class="ticket-ref">${escapeHtml(i.ticketNumber)}</span>
          </li>`
          )
          .join("")}
      </ul>`
      : "";

  const actions =
    a.recommendedActions.length > 0
      ? `<ul class="focus-list">
        ${a.recommendedActions.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}
      </ul>`
      : "";

  return `
    <section class="report-section clinical-analysis ${trajectoryClass}">
      <h3>Clinical progress analysis <span class="count">(intelligence layer)</span></h3>
      <p class="analysis-summary">${escapeHtml(a.summary)}</p>
      <p class="analysis-trend"><strong>Trajectory:</strong> ${escapeHtml(a.trajectoryLabel)}</p>
      ${insights ? `<h4 class="subcategory-title">Session signals</h4>${insights}` : ""}
      ${actions ? `<h4 class="subcategory-title">Recommended actions</h4>${actions}` : ""}
      <p class="analysis-meta">Analysed ${a.sessionCount} sessions · ${a.positiveCount} positive · ${a.concernCount} concern flags</p>
    </section>`;
}

function renderHealthPart(report: FamilyMonthlyReport): string {
  const h = report.health;
  if (!h) return "";

  const domainRows =
    h.domainScores.length > 0
      ? `<section class="report-section">
      <h3>Cognitive &amp; functional domain progress</h3>
      <table class="domain-table">
        <tbody>
          ${h.domainScores
            .map(
              (d) => `
            <tr>
              <td>${escapeHtml(d.label)}</td>
              <td class="domain-status status-${d.status}">${escapeHtml(DOMAIN_STATUS_LABELS[d.status])}</td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </section>`
      : "";

  const milestones =
    h.milestones.length > 0
      ? `<section class="report-section">
      <h3>Session milestones — key clinical notes</h3>
      <ul class="milestones">
        ${h.milestones
          .map(
            (m) => `
          <li>
            <span class="milestone-date">${escapeHtml(m.dateLabel)}</span>
            <strong>${escapeHtml(m.title)}</strong>
            <p>${escapeHtml(m.body)}</p>
          </li>`
          )
          .join("")}
      </ul>
    </section>`
      : "";

  const focusList =
    h.recommendedFocus.length > 0
      ? `<section class="report-section">
      <h3>Recommended focus going forward</h3>
      <ul class="focus-list">
        ${h.recommendedFocus.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}
      </ul>
    </section>`
      : "";

  const schedule = h.careSchedule
    ? `<section class="report-section schedule-box">
      <h3>Current care schedule</h3>
      <p>${escapeHtml(h.careSchedule)}</p>
    </section>`
    : "";

  return `
    <div class="health-header">
      <p class="health-subtitle">
        ${escapeHtml(h.subjectName)} (${escapeHtml(report.benefactor)} Family, ${escapeHtml(report.city)})
      </p>
      <p class="health-staff">
        Physiotherapist: ${escapeHtml(h.physiotherapist)} · Field doctor: ${escapeHtml(h.fieldDoctor)}
      </p>
      <p class="health-staff">
        Senior consultants: ${escapeHtml(h.seniorConsultant)} · Wellness counsellor: ${escapeHtml(h.wellnessCounsellor)}
      </p>
      <p class="health-trend"><strong>Overall trend:</strong> ${escapeHtml(h.overallTrend)}</p>
    </div>
    ${domainRows}
    ${renderClinicalAnalysis(report)}
    ${renderPhysioSessions(report.physioSessions)}
    ${renderMedicalSessions(report.medicalSessions)}
    ${milestones}
    ${focusList}
    ${schedule}
    <p class="health-footer">${escapeHtml(h.footerNote)}</p>`;
}

function renderProfileSnippet(report: FamilyMonthlyReport): string {
  const p = report.profile;
  const traits: string[] = [];
  if (p.hobbies.length) traits.push(`<strong>Beneficiary hobbies:</strong> ${escapeHtml(p.hobbies.join(", "))}`);
  if (p.interests.length) traits.push(`<strong>Beneficiary interests:</strong> ${escapeHtml(p.interests.join(", "))}`);
  if (p.prefersLowTouch) traits.push("Prefers low-touch engagement unless family initiates");
  if (p.indoorOnly) traits.push("Indoor-only engagements");

  const notes = p.engagementNotes
    .map((n) => `<li>${escapeHtml(n)}</li>`)
    .join("");

  const bira = p.biraBeneficiaries
    .map(
      (b) =>
        `<li>${escapeHtml(b.name)}${b.birthdayLabel ? ` · ${escapeHtml(b.birthdayLabel)}` : ""}</li>`
    )
    .join("");

  if (!traits.length && !notes && !bira) return "";

  return `
    <section class="report-section profile-snippet">
      <h3>Family context</h3>
      ${traits.map((t) => `<p class="profile-line">${t}</p>`).join("")}
      ${notes ? `<ul class="profile-list">${notes}</ul>` : ""}
      ${bira ? `<p class="profile-label">BIRA beneficiaries:</p><ul class="profile-list">${bira}</ul>` : ""}
    </section>`;
}

export function renderFamilyReportHtml(report: FamilyMonthlyReport): string {
  const focusLine = report.beneficiaryFocus
    ? `<p class="focus">Beneficiary focus: <strong>${escapeHtml(report.beneficiaryFocus)}</strong></p>`
    : report.beneficiaries.length
      ? `<p class="focus">Family members: ${escapeHtml(report.beneficiaries.join(" · "))}</p>`
      : "";

  const conciergeHtml = report.conciergeSections
    .filter((s) => s.count > 0)
    .map((s) => renderSectionTable(s))
    .join("\n");

  const generated = new Date(report.generatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Karachi",
  });

  const emptyConcierge =
    report.summary.conciergeCount === 0
      ? `<p class="empty prominent">No non-emergency errand tickets this month.</p>`
      : "";

  const emptyMedical =
    report.summary.medicalCount === 0
      ? `<p class="empty">No medical tickets logged this month.</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(report.benefactor)} — ${escapeHtml(report.monthLabel)} Report</title>
  <style>
    :root { --brand: #1e4d6b; --brand-light: #e8f1f6; --text: #1a1a1a; --muted: #5c6670; --border: #d4dde4; --accent: #2d7a4f; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Georgia, "Times New Roman", serif; color: var(--text); background: #fff; font-size: 11pt; line-height: 1.5; }
    .page { max-width: 210mm; margin: 0 auto; padding: 18mm 16mm; }
    .brand-bar { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid var(--brand); padding-bottom: 10px; margin-bottom: 20px; }
    .brand { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 22pt; font-weight: 700; color: var(--brand); }
    .doc-type { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9pt; color: var(--muted); text-align: right; }
    h1 { font-size: 16pt; font-weight: normal; color: var(--brand); margin-bottom: 6px; }
    h2.part-title { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 13pt; color: var(--brand); margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid var(--accent); }
    h3 { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 11pt; font-weight: 600; color: var(--brand); border-bottom: 1px solid var(--border); padding-bottom: 4px; margin-bottom: 8px; }
    h3 .count { font-weight: 400; color: var(--muted); font-size: 10pt; }
    .meta { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; color: var(--muted); margin-bottom: 16px; }
    .meta strong { color: var(--text); }
    .focus { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 10pt; margin-bottom: 14px; padding: 8px 12px; background: var(--brand-light); border-left: 3px solid var(--brand); }
    .summary-box { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0 22px; padding: 14px; background: #f7f9fa; border: 1px solid var(--border); border-radius: 4px; font-family: "Helvetica Neue", Arial, sans-serif; font-size: 10pt; }
    .summary-box strong { color: var(--brand); }
    .health-header { margin: 12px 0; padding: 12px 14px; background: #f0f7f4; border-left: 4px solid var(--accent); }
    .health-subtitle { font-size: 12pt; font-weight: 600; color: var(--brand); }
    .health-staff, .health-trend { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; color: var(--muted); margin-top: 4px; }
    .domain-table td { padding: 5px 8px; border-bottom: 1px solid #eef1f3; }
    .domain-status { text-align: right; font-size: 9pt; font-weight: 600; }
    .status-good { color: #2d7a4f; } .status-improving { color: #b45309; } .status-needs_focus { color: #be123c; }
    .milestones { list-style: none; padding: 0; }
    .milestones li { margin-bottom: 12px; padding-left: 12px; border-left: 3px solid var(--accent); }
    .milestone-date { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 9pt; font-weight: 700; color: var(--brand); display: block; }
    .milestones p { margin-top: 4px; font-size: 9.5pt; }
    .focus-list, .profile-list { padding-left: 18px; font-size: 9.5pt; }
    .focus-list li, .profile-list li { margin-bottom: 6px; }
    .schedule-box { background: #f7f9fa; padding: 12px; border: 1px solid var(--border); border-radius: 4px; }
    .health-footer { font-size: 8.5pt; color: var(--muted); margin-top: 16px; }
    .profile-snippet { background: #fafbfc; padding: 12px; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 16px; }
    .profile-line { font-size: 9.5pt; margin-bottom: 4px; }
    .profile-label { font-size: 9pt; font-weight: 600; margin-top: 8px; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
    th { font-family: "Helvetica Neue", Arial, sans-serif; text-align: left; font-weight: 600; font-size: 8.5pt; color: var(--muted); padding: 5px 8px; border-bottom: 2px solid var(--border); }
    td { padding: 6px 8px; border-bottom: 1px solid #eef1f3; vertical-align: top; }
    .col-date { width: 12%; white-space: nowrap; }
    .col-patient { width: 14%; }
    .col-practitioner { width: 14%; }
    .col-service { width: 18%; }
    .col-notes { width: 42%; }
    .col-summary { width: 86%; }
    .pre-wrap { white-space: pre-wrap; }
    h4.subcategory-title { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 10pt; font-weight: 600; color: var(--muted); margin: 12px 0 6px; }
    .clinical-analysis { background: #f5f9fc; padding: 12px; border: 1px solid #d4e4ef; border-radius: 4px; margin-bottom: 16px; }
    .analysis-summary, .analysis-trend { font-size: 9.5pt; margin-bottom: 8px; }
    .analysis-meta { font-size: 8.5pt; color: var(--muted); margin-top: 10px; }
    .insight-list { list-style: none; padding: 0; }
    .insight-list li { margin-bottom: 8px; padding: 8px 10px; border-radius: 3px; font-size: 9pt; }
    .insight-positive { background: #eef8f2; border-left: 3px solid #2d7a4f; }
    .insight-neutral { background: #f7f9fa; border-left: 3px solid #94a3b8; }
    .insight-concern { background: #fef2f2; border-left: 3px solid #be123c; }
    .ticket-ref { font-family: monospace; font-size: 8pt; color: var(--muted); margin-left: 6px; }
    .trajectory-improving .analysis-trend { color: #2d7a4f; }
    .trajectory-needs_attention .analysis-trend { color: #be123c; }
    .physio-section { background: #f8fbf9; padding: 12px; border: 1px solid #d8e8df; border-radius: 4px; margin-bottom: 16px; }
    .medical-log td { font-size: 9pt; }
    .empty { color: var(--muted); font-style: italic; font-size: 9.5pt; }
    .empty.prominent { margin: 16px 0; }
    .disclaimer { margin-top: 28px; padding: 12px 14px; font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8.5pt; color: var(--muted); background: #fafbfc; border: 1px solid var(--border); border-radius: 3px; }
    .footer { margin-top: 20px; font-family: "Helvetica Neue", Arial, sans-serif; font-size: 8pt; color: var(--muted); text-align: center; }
    .page-break { page-break-before: always; margin-top: 24px; }
    @media print { body { background: #fff; } .page { padding: 12mm 10mm; max-width: none; } }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand-bar">
      <div class="brand">Mohsyn</div>
      <div class="doc-type">Family Care Report<br/>${escapeHtml(report.periodMode === "month" ? "Monthly" : report.periodMode === "week" ? "Weekly" : "Custom period")}<br/>Confidential</div>
    </div>

    <h1>${escapeHtml(report.benefactor)} — ${escapeHtml(report.monthLabel)}</h1>
    <div class="meta">
      <strong>${escapeHtml(report.city)}</strong> · ${escapeHtml(report.beneficiary)}<br/>
      Prepared by Mohsyn Care Team · ${escapeHtml(generated)}
    </div>

    ${focusLine}

    <div class="summary-box">
      <span><strong>${formatNumber(report.summary.medicalCount)}</strong> medical / clinical</span>
      <span> · </span>
      <span><strong>${formatNumber(report.summary.conciergeCount)}</strong> concierge &amp; errands</span>
      <span> · </span>
      <span><strong>${formatNumber(report.summary.totalTickets)}</strong> total</span>
    </div>

    <h2 class="part-title">Part I — Medical &amp; clinical progress</h2>
    ${emptyMedical}
    ${renderHealthPart(report)}

    <div class="page-break"></div>

    <h2 class="part-title">Part II — Concierge &amp; non-emergency errands</h2>
    ${renderProfileSnippet(report)}
    ${emptyConcierge}
    ${conciergeHtml}

    <div class="disclaimer">
      <strong>Note:</strong> ${escapeHtml(report.coverageNote)}
    </div>

    <div class="footer">Mohsyn — Premium family concierge &amp; care coordination · mohsyn.com</div>
  </div>
</body>
</html>`;
}
