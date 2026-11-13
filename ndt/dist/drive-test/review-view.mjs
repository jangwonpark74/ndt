import {acceptance, elapsed, fails, filterSamples, fmt, metricValue, METRICS, pct, utc} from './test-model.mjs';
import {$, compact, esc, table} from './test-view.mjs';

const LABEL = {pass: 'Within target', fail: 'Outside target', insufficient: 'Insufficient evidence'};
const badge = (status, label = LABEL[status]) => `<span class="verdict ${status}">${esc(label)}</span>`;

export function renderQuality(vm) {
  const checks = acceptance(vm.analysis, vm.metric, vm.rat, vm.profile);
  const status = checks.some(c => c.status === 'insufficient') ? 'insufficient' : checks.some(c => c.status === 'fail') ? 'fail' : 'pass';
  $('quality-summary').innerHTML = `<div class="quality-heading"><div><span class="eyebrow">Analysis readiness</span>
    <strong>${esc(vm.profile.name)}</strong><span class="profile-revision">${vm.test.revision ? `Saved · revision ${vm.test.revision}` : 'Default profile · not yet saved'}</span></div>
    ${badge(status)}</div><div class="quality-checks">${checks.map(c => `<div class="quality-check"><div><b>${c.rat} · ${METRICS[vm.metric].label}</b>${badge(c.status)}</div>
      <p>${esc(c.reasons.join(' · '))}</p><div class="quality-facts"><span>Metric <b>${pct(c.coverage)}</b></span><span>GPS <b>${pct(c.gps)}</b></span><span>Valid <b>${compact(c.n)}</b></span></div>
    </div>`).join('')}</div><p class="quality-method">${vm.test.kind === 'synthetic' ? 'Synthetic evaluation · ' : ''}Selected metric only · sample-weighted · missing evidence prevents a pass. ${vm.metric==='measured_rx_dbm'?'Only explicitly valid readings enter summaries. Instrument and model compatibility require a separate Field validation study. ':''}<button id="edit-profile" class="link-button">Edit acceptance profile</button></p>`;
}

export const sampleRows = (vm, state) => filterSamples(vm.series, vm.metric, vm.limits, state);

export function renderSamples(vm, state) {
  const filtered = sampleRows(vm, state), size = 50;
  state.page = Math.max(0, Math.min(state.page, Math.ceil(filtered.length / size) - 1));
  const start = state.page * size, page = filtered.slice(start, start + size), def = METRICS[vm.metric];
  $('sample-count').textContent = `${compact(filtered.length)} matching observations · ${def.label} (${def.unit})`;
  $('sample-page').textContent = filtered.length ? `${compact(start + 1)}–${compact(start + page.length)} of ${compact(filtered.length)}` : 'No matching observations';
  $('samples-prev').disabled = !state.page;
  $('samples-next').disabled = start + size >= filtered.length;
  $('sample-table').innerHTML = page.length ? `<div class="table-wrap sample-scroll"><table><thead><tr>
    ${['Sample / UTC', 'RAT', 'Cell / PCI', def.label + ' (' + def.unit + ')', 'GPS', 'Status'].map(h => `<th scope="col">${esc(h)}</th>`).join('')}
    </tr></thead><tbody>${page.map((row, i) => {
      const value=metricValue(row,vm.metric),status = !Number.isFinite(value) ? 'missing' : fails(value, row.rat, vm.metric, vm.limits) ? 'fail' : 'pass';
      return `<tr data-time="${row.t}" data-rat="${row.rat}" class="${row === vm.selected ? 'is-selected' : ''}"><td><button class="sample-jump" data-sample="${start + i}">${esc(utc(row.t))}</button>
        <small class="sample-elapsed">+${elapsed(row.t - vm.test.start, true)}</small></td><td>${row.rat}</td><td>${esc(row.cell_id || '—')}<small class="sample-elapsed">PCI ${row.pci ?? '—'} · ${esc(row.band || '—')}</small></td>
        <td class="mono">${fmt(row[vm.metric])}${vm.metric==='measured_rx_dbm'?`<small class="sample-elapsed">${esc(row.measurement_status||'Quality unknown')}</small>`:''}</td><td>${Number.isFinite(row.latitude) ? 'Valid fix' : 'Missing'}</td><td>${badge(status, status === 'missing' ? 'Missing / excluded' : status === 'fail' ? 'Outside threshold' : 'Within threshold')}</td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="empty">No observations match these filters. Change the search or status.</p>';
}

export function renderInvestigations(vm, state) {
  const issues = vm.test.issues || [], open = issues.filter(i => i.status === 'open').length;
  $('issue-count').textContent = `${open} open · ${issues.length - open} resolved`;
  $('issues').innerHTML = issues.slice().reverse().map(issue => `<article class="issue-card ${issue.status === 'resolved' ? 'resolved' : ''}">
    <div class="issue-heading"><span class="severity ${issue.severity}">${issue.severity}</span><span class="issue-status">${issue.status}</span><span class="mono">${issue.rat} · +${elapsed(issue.t - vm.test.start, true)}</span></div>
    <h3>${esc(issue.title)}</h3>${issue.note ? `<p>${esc(issue.note)}</p>` : ''}
    <div class="issue-actions"><small>${METRICS[issue.metric].label} · recorded ${esc(utc(Date.parse(issue.created)))}</small>
    <button data-issue-jump="${esc(issue.id)}">Locate sample</button><button data-issue-status="${esc(issue.id)}" data-status="${issue.status === 'open' ? 'resolved' : 'open'}">${issue.status === 'open' ? 'Resolve' : 'Reopen'}</button></div></article>`).join('') ||
    '<div class="investigation-empty"><strong>No issues recorded</strong><p>Select an observation and flag it with your finding. Issues remain attached to this Test ID.</p></div>';
  const audit = vm.test.audit || [];
  $('audit-log').innerHTML = audit.length ? table(['UTC', 'Action', 'Detail'], audit.map(a => [utc(Date.parse(a.at)), a.action, a.detail])) :
    '<p class="empty">Profile and issue changes will appear here.</p>';
  renderSamples(vm, state);
}

export function updateSampleCursor(vm) {
  for (const row of document.querySelectorAll('#sample-table tr[data-time]')) {
    row.classList.toggle('is-selected', Number(row.dataset.time) === vm.selected?.t && row.dataset.rat === vm.selected?.rat);
  }
}
