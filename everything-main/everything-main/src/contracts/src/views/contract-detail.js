import { el, clear, append, preservingFocus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  store, typeInfo, BILLING_PERIODS, liveDocuments, TRASH_DAYS, TERM_ENDING_LABELS, endedOn,
} from '../lib/store.js';
import { renewalInfo, formatDate, relativeDays, dateToISO, needsAttention } from '../lib/dates.js';
import { openDecisionSheet, decisionSummary } from '../ui/decision.js';
import { hasCalendarEvents } from '../lib/ical.js';
import {
  documentText, isReadableDoc, isPdfDoc, isImageDoc, readSummary,
} from '../lib/doctext.js';
import { openDocumentPreview } from '../ui/doc-preview.js';
import { singleContractCalendar, calendarFilename, appBaseUrl } from '../lib/calendar.js';
import { extractObligations, MAX_EXTRACT_CHARS } from '../lib/extract.js';
import { formatMoney, formatBytes, downloadBlob, DOT, joinDot } from '../lib/util.js';
import { openModal, confirmDialog } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import {
  phaseBadge, renewalLine, typeGlyph, ownerBadge, avatar, emptyState, obligationRow,
  field, textInput,
} from '../ui/bits.js';
import { openContractForm } from '../ui/contract-form.js';
import { openObligationForm } from '../ui/obligation-form.js';

export function contractDetailView({ param }) {
  const root = el('div.view');
  const body = el('div');

  // The whole body re-renders on store changes; give keyboard focus back to
  // the same control (e.g. the obligation checkbox just toggled), or to the
  // one that replaced it when the action removed it from the list.
  function render() {
    preservingFocus(body, draw, { fallback: '.ob-check' });
  }

  function draw() {
    clear(body);
    const contract = store.contractById(param);
    if (!contract) {
      body.append(emptyState({
        icon: 'file-text',
        title: 'Contract not found',
        sub: 'It may have been deleted.',
        action: el('a.btn.btn-primary', { href: '#/contracts' }, 'Back to contracts'),
      }));
      return;
    }
    const info = renewalInfo(contract);
    const contact = store.contactById(contract.contactId);

    /* Header */
    body.append(el('div.detail-head', {},
      typeGlyph(contract, 24),
      el('div.grow.min0', {},
        el('h1.detail-title', {}, contract.title),
        // The type and the tags are one run of text rather than two boxes
        // beside each other: as separate items they wrapped whole, and a
        // phone-width header ended its first line on the separator between
        // them with the tags stranded on the next.
        el('div.detail-meta', {},
          phaseBadge(contract, info),
          el('span', {}, joinDot([typeInfo(contract.type).label, contract.tags.join(', ')]))
        )
      ),
      el('div.row', {},
        // Only offered when there is something dated to put in a calendar.
        hasCalendarEvents(contract, { baseUrl: appBaseUrl() }) && el('button.icon-btn', {
          html: icon('calendar', 18, 2),
          'aria-label': 'Add these deadlines to a calendar',
          title: 'Download calendar file (.ics)',
          onclick: () => {
            const { text, count } = singleContractCalendar(contract);
            downloadBlob(new Blob([text], { type: 'text/calendar;charset=utf-8' }),
              calendarFilename(contract.title));
            toast(`${count} deadline${count === 1 ? '' : 's'} exported`, { icon: 'calendar' });
          },
        }),
        el('button.btn.btn-ghost', {
          html: icon('pencil', 15, 2),
          onclick: () => openContractForm({ contract }),
        }, ' Edit'),
        el('button.icon-btn.danger', {
          html: icon('trash', 18, 2), 'aria-label': 'Delete contract',
          title: 'Delete contract',
          onclick: async () => {
            const docCount = liveDocuments(contract).length;
            const ok = await confirmDialog({
              title: 'Delete this contract?',
              message: docCount
                ? `"${contract.title}" and its ${docCount} attached document${docCount === 1 ? '' : 's'} move to the trash. You can restore them there for ${TRASH_DAYS} days.`
                : `"${contract.title}" moves to the trash. You can restore it there for ${TRASH_DAYS} days.`,
              confirmLabel: 'Delete',
            });
            if (!ok) return;
            try {
              await store.deleteContract(contract.id);
              location.hash = '#/contracts';
              toast('Contract deleted', {
                icon: 'trash',
                action: {
                  label: 'Undo',
                  onClick: () => {
                    store.restoreContract(contract.id)
                      .then(() => { location.hash = `#/contracts/${contract.id}`; })
                      .catch(() => toast('Could not restore. Check your connection', { icon: 'wifiOff' }));
                  },
                },
              });
            } catch (err) {
              console.error(err);
              toast('Could not delete. Check your connection', { icon: 'wifiOff' });
            }
          },
        })
      )
    ));

    /* Renewal callout, with the decision that answers it */
    if (info.date && contract.status === 'active') {
      const attention = needsAttention(contract, info);
      const tone = attention ? 'danger'
        : info.handled ? 'ok'
          : info.phase === 'soon' ? 'warn' : 'ok';
      const decidable = attention || info.phase === 'soon' || info.handled;
      body.append(el(`div.callout.callout-${tone}`, {},
        el('span', {
          html: icon(info.handled ? 'done'
            : info.phase === 'expired' ? 'warning'
              : contract.autoRenew ? 'renew' : 'calendar', 18, 2),
        }),
        el('div.grow.min0', {},
          el('strong', {}, info.handled ? decisionSummary(info) : renewalLine(contract, info)),
          info.handled && info.decision.note
            ? el('div.callout-sub', {}, info.decision.note)
            : null,
          !info.handled && info.noticeDate && info.phase !== 'expired' && el('div.callout-sub', {},
            info.noticeDaysLeft >= 0
              ? `Cancellation notice must be given by ${formatDate(info.noticeDate)} (${relativeDays(info.noticeDaysLeft)}).`
              : `The notice deadline passed ${formatDate(info.noticeDate)}; the term ${contract.autoRenew ? 'will renew' : 'ends'} as scheduled.`),
          !info.handled && info.phase === 'expired' && el('div.callout-sub', {},
            'Record what happened, or update the end date.'),
          decidable && el('div.row.wrap', { style: { marginTop: '10px' } },
            el('button.btn.btn-compact', {
              className: `btn btn-compact ${info.handled ? 'btn-ghost' : 'btn-primary'}`,
              onclick: () => openDecisionSheet(contract, info),
            }, info.handled ? 'Change decision' : 'Record a decision')
          )
        )
      ));
    }

    /* Facts */
    // An auto-renewing contract keeps the end date of its *first* term — that
    // is the anchor every later term is measured from. Printing it plainly as
    // "End date" put a date a year in the past next to a callout saying the
    // contract renews next year, and read as an agreement that had lapsed.
    const rolled = info.date && contract.endDate && info.date !== contract.endDate
      ? info.date : null;
    // A closed-out contract has no clock to show, only the day it stopped —
    // which on an auto-renewing one is the last term recorded, not the first
    // term's end that `endDate` still holds.
    const ended = contract.status === 'terminated' ? endedOn(contract) : null;
    const facts = el('div.facts', {},
      fact('Counterparty', contact
        ? el('a.fact-link', { href: `#/contacts/${contact.id}` },
          avatar(contact.name), `${contact.name}${contact.company ? `, ${contact.company}` : ''}`)
        : el('span.muted', {}, 'None')),
      fact('Value', contract.value !== null
        ? `${formatMoney(contract.value, contract.currency)} ${billingLabel(contract.billing)}`
        : el('span.muted', {}, 'Not set')),
      fact('Start date', contract.startDate ? formatDate(contract.startDate) : el('span.muted', {}, 'Not set')),
      contract.status === 'terminated'
        ? fact('Ended', ended ? formatDate(ended) : el('span.muted', {}, 'Date not recorded'))
        : fact(rolled ? 'Current term ends' : 'End date',
          rolled ? formatDate(rolled)
            : contract.endDate ? formatDate(contract.endDate) : el('span.muted', {}, 'None (evergreen)')),
      fact('Renewal', contract.autoRenew ? `Auto-renews every ${contract.termMonths} months` : 'Fixed term'),
      fact('Notice period', contract.noticeDays ? `${contract.noticeDays} days` : el('span.muted', {}, 'None'))
    );
    body.append(el('section.card', {}, facts));

    body.append(renderObligations(contract));
    body.append(renderDocuments(contract));
    const history = renderTermHistory(contract);
    if (history) body.append(history);

    if (contract.notes.trim()) {
      body.append(el('section.card', {},
        el('div.card-head', {}, el('h2.card-title', {}, 'Notes')),
        el('p.notes-text', {}, contract.notes)
      ));
    }
  }

  function fact(label, value) {
    return el('div.fact', {},
      el('div.fact-label', {}, label),
      el('div.fact-value', {}, value)
    );
  }

  function billingLabel(billing) {
    if (billing === 'one-time') return 'one-time';
    return { monthly: 'per month', quarterly: 'per quarter', annual: 'per year' }[billing]
      || BILLING_PERIODS.find((b) => b.value === billing)?.label || '';
  }

  /* --- term history --- */

  /**
   * Every term this contract has been through, newest first. Answers "how
   * long have we been with this vendor, and what did we pay each term?" —
   * which updatedAt alone never could.
   */
  function renderTermHistory(contract) {
    const terms = contract.termHistory || [];
    if (!terms.length) return null;
    return el('section.card', {},
      el('div.card-head', {},
        el('div', {},
          el('h2.card-title', {}, 'Term history'),
          el('p.card-sub', {}, `${terms.length} completed term${terms.length === 1 ? '' : 's'}`)
        )
      ),
      el('div.list', {}, [...terms].reverse().map((term) =>
        el('div.term-row', {},
          el('span.term-mark', {
            html: icon(term.ended === 'renewed' ? 'renew' : term.ended === 'notice-given' ? 'mail' : 'calendar', 15, 2),
          }),
          el('div.grow.min0', {},
            el('div.row-title', {},
              `${term.start ? `${formatDate(term.start)} – ` : 'Until '}${formatDate(term.end)}`),
            term.note ? el('div.row-sub.wrap', {}, term.note) : null
          ),
          term.value !== null
            ? el('span.term-value', {}, `${formatMoney(term.value, term.currency)} ${billingLabel(contract.billing)}`)
            : null,
          el('span.badge.badge-muted', {}, TERM_ENDING_LABELS[term.ended] || term.ended)
        )))
    );
  }

  /* --- obligations --- */

  function renderObligations(contract) {
    const open = (contract.obligations || []).filter((o) => !o.done);
    const done = (contract.obligations || []).filter((o) => o.done);

    const section = el('section.card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, `Obligations${open.length ? ` (${open.length} open)` : ''}`),
        el('div.row', {},
          el('button.btn.btn-ghost.btn-compact', {
            html: icon('sparkle', 14, 2),
            onclick: () => openExtractModal(contract),
          }, ' Extract with AI'),
          el('button.btn.btn-ghost.btn-compact', {
            html: icon('plus', 14, 2.2),
            onclick: () => openObligationForm({ contract }),
          }, ' Add')
        )
      )
    );

    if (!open.length && !done.length) {
      section.append(el('p.quiet-note', {},
        'Track what each side owes: payments, deliverables, notices. Add them by hand or let AI read the contract text.'));
      return section;
    }

    const item = (ob) => obligationRow(contract, ob, {
      onToggle: (done) => {
        store.setObligation(contract.id, ob.id, { done })
          .catch(() => toast('Could not save. Check your connection', { icon: 'wifiOff' }));
      },
      onEdit: () => openObligationForm({ contract, obligation: ob }),
      onDelete: async () => {
        // One tap deletes, so the way back has to be just as easy: an
        // extraction the user spent time reviewing is not disposable.
        let removed;
        try {
          removed = await store.deleteObligation(contract.id, ob.id);
        } catch {
          toast('Could not delete. Check your connection', { icon: 'wifiOff' });
          return;
        }
        if (!removed) return;
        toast('Obligation deleted', {
          icon: 'trash',
          action: {
            label: 'Undo',
            onClick: () => {
              store.restoreObligation(contract.id, removed.obligation, removed.index)
                .catch(() => toast('Could not restore. Check your connection', { icon: 'wifiOff' }));
            },
          },
        });
      },
    });

    section.append(el('div.list', {}, open.map(item)));
    if (done.length) {
      section.append(
        el('div.list-sep', {}, `Completed (${done.length})`),
        el('div.list', {}, done.map(item))
      );
    }
    return section;
  }

  /* --- AI extraction --- */

  function openExtractModal(contract) {
    const bodyEl = el('div');
    let busy = false;      // AI request in flight
    let reviewing = false; // suggestions on screen, not yet saved
    let pendingText = '';  // last run's text, recoverable from error screens
    const modal = openModal({
      title: 'Extract obligations',
      content: bodyEl,
      beforeClose: () => {
        const dirty = busy || reviewing || !!pendingText.trim()
          || !!bodyEl.querySelector('textarea')?.value.trim();
        return !dirty || confirmDialog({
          title: 'Discard extraction?',
          message: busy || reviewing
            ? 'The suggestions from this run will be lost.'
            : 'The pasted agreement text will be lost.',
          confirmLabel: 'Discard',
        });
      },
    });

    function renderInput(prefill = '', note = '') {
      busy = false;
      reviewing = false;
      pendingText = '';
      clear(bodyEl);
      // Any document the app can turn into text is offered, not just .txt:
      // nobody has their MSA as a text file.
      const readable = liveDocuments(contract).filter(isReadableDoc);
      const textarea = el('textarea.input.extract-input', {
        rows: 10,
        placeholder: 'Paste the agreement text here…',
        'aria-label': 'Agreement text',
        maxLength: MAX_EXTRACT_CHARS,
        value: prefill,
      });
      const runBtn = el('button.btn.btn-primary.btn-block', {
        html: icon('sparkle', 15, 2),
        onclick: () => {
          const text = textarea.value.trim();
          if (text.length < 40) {
            toast('Paste more of the agreement first', { icon: 'info' });
            return;
          }
          run(text);
        },
      }, ' Find obligations');

      append(bodyEl, [
        el('p.modal-note', {},
          'AI reads the text and suggests the duties it creates. Nothing is saved until you approve it.'),
        readable.length ? el('div.doc-source-row', {},
          el('span.field-label', {}, 'Load from an attached document:'),
          el('div.row.wrap', {}, readable.map((doc) =>
            el('button.chip', {
              type: 'button',
              onclick: (e) => loadFromDocument(doc, e.currentTarget),
            }, doc.name)))
        ) : null,
        note ? el('p.field-hint', { style: { marginBottom: '10px' } }, note) : null,
        field('Agreement text', textarea),
        runBtn,
      ]);

      // Arriving here with text already in the box means the user came back to
      // it — from a document, from "Start over", from a failed run — so the box
      // is where they are. The rebuild above dropped focus to the body instead,
      // leaving a keyboard user to tab in from the top of the sheet. Wound back
      // to the start, because what matters is the head of the agreement, not
      // its last line. Same width rule as the sheet's own autofocus: on a phone
      // the keyboard would cover what was just loaded.
      if (prefill && matchMedia('(min-width: 640px)').matches) {
        textarea.focus();
        textarea.setSelectionRange(0, 0);
        textarea.scrollTop = 0;
      }
    }

    /**
     * Fill the textarea from an attachment: text directly, a PDF's text layer
     * via pdf.js, and a scan by OCR — which sends page images to the AI, so it
     * is confirmed once before the first time.
     */
    async function loadFromDocument(doc, chip) {
      chip.disabled = true;
      const label = chip.textContent;
      const say = (message) => { chip.textContent = message; };
      try {
        const result = await documentText(doc, {
          read: (d) => store.readDocument(d),
          onStatus: say,
          // Asked only when OCR is genuinely the only way to read it, and only
          // the first time: this is the one path that sends pages to the AI.
          confirmOcr: async () => {
            if (store.settings.ocrConsent) return true;
            const ok = await confirmDialog({
              title: 'Read the pages with AI?',
              message: 'This document has no text in it, so it can only be read as images by Puter\'s AI. PDFs that do contain text are read here in your browser and never leave your device. Agreeing covers scans from now on, so this is not asked per document. Settings can turn it back into a question.',
              confirmLabel: 'Read it',
              danger: false,
            });
            if (ok) store.updateSettings({ ocrConsent: true }).catch(() => {});
            return ok;
          },
        });
        if (!result.text.trim()) {
          toast('No text could be read from that document', { icon: 'info' });
          return;
        }
        // The note stays on screen: how the text was read changes how closely
        // the suggestions should be reviewed. renderInput owns the box and its
        // focus, so nothing is set on the textarea it is about to replace.
        renderInput(result.text, readSummary(result));
        return;
      } catch (err) {
        if (err?.message === 'OCR_DECLINED') return;
        console.error(err);
        toast(err?.message === 'UNREADABLE_DOC'
          ? 'That file type cannot be read as text'
          : 'Could not read that document. Check your connection', { icon: 'wifiOff' });
      } finally {
        chip.disabled = false;
        chip.textContent = label;
      }
    }

    async function run(text) {
      busy = true;
      pendingText = text;
      clear(bodyEl);
      bodyEl.append(el('div.extract-busy', {},
        el('span.spinner', { 'aria-hidden': 'true' }),
        el('p', { role: 'status' }, 'Reading the agreement…')
      ));
      let suggestions;
      try {
        suggestions = await extractObligations(text);
      } catch (err) {
        console.error(err);
        busy = false;
        clear(bodyEl);
        bodyEl.append(
          el('p.modal-note', {}, 'The AI request failed. Check your connection and try again.'),
          el('button.btn.btn-primary.btn-block', { onclick: () => renderInput(text) }, 'Back')
        );
        return;
      }
      busy = false;
      if (!suggestions.length) {
        clear(bodyEl);
        bodyEl.append(
          el('p.modal-note', {}, 'No concrete obligations were found in that text. Try pasting the full clauses (payment, delivery, notice periods).'),
          el('button.btn.btn-primary.btn-block', { onclick: () => renderInput(text) }, 'Back')
        );
        return;
      }
      renderReview(suggestions, text);
    }

    function renderReview(suggestions, text) {
      reviewing = true;
      clear(bodyEl);
      const picked = new Set(suggestions.map((_, i) => i));
      // A suggested cadence needs a first date to count from. The model rarely
      // states one ("within 30 days of each month's end"), so the date is
      // asked for here rather than invented.
      const firstDue = new Map();
      const list = el('div.list', {}, suggestions.map((s, i) => {
        const meta = el('div.ob-meta', {});
        if (s.due) meta.append(el('span', {}, `due ${formatDate(s.due)}`));
        if (s.repeat) {
          if (meta.childNodes.length) meta.append(document.createTextNode(DOT));
          meta.append(el('span.ob-cadence', { html: icon('renew', 12, 2.2) }, ` ${s.repeat}`));
        }
        let dateField = null;
        if (s.repeat) {
          const input = textInput({ type: 'date', value: s.due || '', className: 'input sug-due' });
          firstDue.set(i, input);
          dateField = el('div.sug-first-due', {},
            el('label.field-label', { htmlFor: `sugdue-${i}` }, 'First due'),
            Object.assign(input, { id: `sugdue-${i}` })
          );
        }
        return el('div.ob-row', {},
          el('input', {
            type: 'checkbox', className: 'ob-check', checked: true, id: `sug-${i}`,
            onchange: (e) => { e.target.checked ? picked.add(i) : picked.delete(i); updateCount(); },
          }),
          el('div.grow.min0', {},
            el('label.ob-text', { htmlFor: `sug-${i}` }, s.text),
            meta.childNodes.length ? meta : null,
            dateField
          ),
          ownerBadge(s.owner)
        );
      }));

      const addBtn = el('button.btn.btn-primary.btn-block', {
        onclick: async () => {
          addBtn.disabled = true;
          try {
            const added = await store.addObligations(contract.id, [...picked].map((i) => {
              const s = suggestions[i];
              const due = firstDue.get(i)?.value || s.due || null;
              return {
                text: s.text,
                owner: s.owner,
                due,
                // Without a first date there is no schedule, so it is saved as
                // a one-off rather than as a guess.
                repeat: s.repeat && due
                  ? { every: s.repeat, anchor: due, contractEnd: true }
                  : null,
              };
            }));
            modal.close();
            toast(`${added.length} obligation${added.length === 1 ? '' : 's'} added`, { icon: 'checklist' });
          } catch (err) {
            console.error(err);
            addBtn.disabled = false;
            toast('Could not save. Check your connection', { icon: 'wifiOff' });
          }
        },
      });
      const updateCount = () => {
        addBtn.textContent = picked.size
          ? `Add ${picked.size} obligation${picked.size === 1 ? '' : 's'}`
          : 'Select obligations to add';
        addBtn.disabled = picked.size === 0;
      };
      updateCount();

      const undatedRepeats = suggestions.some((s) => s.repeat && !s.due);
      append(bodyEl, [
        el('p.modal-note', {}, 'Review the suggestions. Uncheck anything wrong, then add the rest.'),
        list,
        undatedRepeats
          ? el('p.field-hint', { style: { marginBottom: '12px' } },
            'A repeating duty needs a first due date. Leave it empty and it is saved as a one-off.')
          : null,
        addBtn,
        el('button.btn.btn-ghost.btn-block', { style: { marginTop: '8px' }, onclick: () => renderInput(text) }, 'Start over'),
      ]);
    }

    renderInput();
  }

  /* --- documents --- */

  function renderDocuments(contract) {
    const docs = liveDocuments(contract);
    const fileInput = el('input', {
      type: 'file', style: { display: 'none' },
      onchange: async () => {
        const file = fileInput.files[0];
        // Clear right away so picking the same file again re-fires change
        // (a rejected or failed file would otherwise be silently ignored).
        fileInput.value = '';
        if (!file) return;
        if (file.size > 25 * 1024 * 1024) {
          toast('Files up to 25 MB only', { icon: 'info' });
          return;
        }
        const t = toast('Uploading…', { icon: 'upload', duration: 60000 });
        try {
          await store.attachDocument(contract.id, file);
          t.dismiss();
          toast('Document attached', { icon: 'paperclip' });
        } catch (err) {
          console.error(err);
          t.dismiss();
          toast('Upload failed. Check your connection', { icon: 'wifiOff' });
        }
      },
    });

    const section = el('section.card', {},
      el('div.card-head', {},
        el('h2.card-title', {}, 'Documents'),
        el('button.btn.btn-ghost.btn-compact', {
          html: icon('fileUp', 14, 2),
          onclick: () => fileInput.click(),
        }, ' Upload')
      ),
      fileInput
    );

    if (!docs.length) {
      section.append(el('p.quiet-note', {},
        'Attach the signed agreement, amendments, and related files. They are stored in your Puter cloud.'));
      return section;
    }

    section.append(el('div.list', {}, docs.map((doc) =>
      el('div.doc-row', {},
        // Tapping the row reads the document here instead of sending the user
        // out of the app to find it in their downloads.
        el('button.doc-open.grow.min0', {
          type: 'button',
          'aria-label': `Preview ${doc.name}`,
          onclick: () => openDocumentPreview(doc),
        },
          el('span.doc-ic', {
            html: icon(isPdfDoc(doc) ? 'file-text' : isImageDoc(doc) ? 'image' : 'paperclip', 17, 1.8),
          }),
          el('span.grow.min0', {},
            el('span.row-title', {}, doc.name),
            el('span.row-sub', {}, `${formatBytes(doc.size)}${DOT}added ${formatDate(dateToISO(new Date(doc.addedAt)))}`)
          )
        ),
        el('button.icon-btn.subtle', {
          html: icon('download', 17, 2), 'aria-label': `Download ${doc.name}`,
          title: 'Download',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const blob = await store.readDocument(doc);
              downloadBlob(blob, doc.name);
            } catch {
              toast('Could not download. Check your connection', { icon: 'wifiOff' });
            }
            btn.disabled = false;
          },
        }),
        el('button.icon-btn.subtle', {
          html: icon('trash', 17, 2), 'aria-label': `Delete ${doc.name}`,
          title: 'Delete document',
          onclick: () => {
            // The delete icon sits next to Download, and on a phone those are
            // one thumb apart — so the file itself stays in your cloud until
            // the trash lets it go, and the way back is one tap.
            store.deleteDocument(contract.id, doc.id)
              .then(() => toast('Document moved to the trash', {
                icon: 'trash',
                action: {
                  label: 'Undo',
                  onClick: () => {
                    store.restoreDocument(contract.id, doc.id)
                      .catch(() => toast('Could not restore. Check your connection', { icon: 'wifiOff' }));
                  },
                },
              }))
              .catch(() => toast('Could not delete. Check your connection', { icon: 'wifiOff' }));
          },
        })
      ))));
    return section;
  }

  root.append(
    el('a.back-link', { href: '#/contracts', html: icon('chevL', 16, 2.2) }, 'Contracts'),
    body
  );

  render();
  store.addEventListener('change', render);
  root.destroy = () => store.removeEventListener('change', render);
  return root;
}
