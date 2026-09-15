import { signalStore, withState, withMethods, patchState } from '@ngrx/signals';
import type { TerminalBalanceUpdatedDto } from '@transacto/contracts';
import type { AlertData, Terminal } from '../interfaces/terminal.interface';

type TerminalState = {
  terminals: Terminal[];
  recentAlerts: AlertData[];
  expandedTerminals: Record<number, boolean>;
};

const initialState: TerminalState = {
  terminals: [],
  recentAlerts: [],
  expandedTerminals: {},
};

/** Newest alerts kept in memory; older ones are dropped. */
const MAX_RECENT_ALERTS = 50;

/**
 * Every terminal the trader owns, plus the alerts attached to them.
 *
 * Written by `SocketSyncService` from live events and by `TerminalApiService`
 * on the initial dashboard load; read by the dashboard and history views.
 */
export const TerminalService = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    setInitialData(terminals: Terminal[], alerts: AlertData[]) {
      patchState(store, { terminals, recentAlerts: alerts });
    },

    updateTerminalBalance(dto: TerminalBalanceUpdatedDto) {
      patchState(store, (state) => {
        const index = state.terminals.findIndex((t) => t.terminalId === dto.terminalId);
        const rawNewData: Partial<Terminal> = {
          terminalId: dto.terminalId,
          cardId: dto.cardId,
          sendId: dto.sendId,
          terminalName: dto.terminalName,
          // The event carries `currentBalance`; there is no `balance` field.
          balance: dto.currentBalance,
          // Undefined when the bank reports no goal, and stripped below rather
          // than written — a scrape without a goal says nothing about the goal.
          goal: dto.goal,
          hasPendingOrders: dto.hasPendingOrders,
          pendingOrdersSum: dto.pendingOrdersSum,
          lastUpdated: dto.updatedAt ? new Date(dto.updatedAt) : new Date(),
        };

        // Undefined fields are dropped so a partial event cannot blank out
        // values the dashboard load already filled in.
        const newData = Object.fromEntries(
          Object.entries(rawNewData).filter(([, value]) => value !== undefined),
        );

        if (index > -1) {
          const newTerminals = [...state.terminals];
          newTerminals[index] = { ...newTerminals[index], ...newData } as Terminal;
          return { terminals: newTerminals };
        }

        return { terminals: [...state.terminals, { ...newData, status: 'ACTIVE' } as Terminal] };
      });
    },

    addAlert(alert: AlertData) {
      patchState(store, (state) => ({
        recentAlerts: [alert, ...state.recentAlerts].slice(0, MAX_RECENT_ALERTS),
      }));

      // An alert is only useful if its terminal is visible, so expand it
      if (alert.terminalId) {
        patchState(store, (state) => ({
          expandedTerminals: { ...state.expandedTerminals, [alert.terminalId as number]: true },
        }));
      }
    },

    removeAlert(alertId: string) {
      patchState(store, (state) => ({
        recentAlerts: state.recentAlerts.filter((a) => a.id !== alertId && a._id !== alertId),
      }));
    },

    markAlertAsRead(alertId: string) {
      patchState(store, (state) => ({
        recentAlerts: state.recentAlerts.map((a) =>
          a.id === alertId || a._id === alertId ? { ...a, isRead: true } : a,
        ),
      }));
    },

    /**
     * A disabled terminal stays on screen while it still has unread alerts —
     * dropping it would take the trader's only notice of what went wrong with it.
     */
    disableTerminalAndCheckRemoval(terminalId: number) {
      patchState(store, (state) => {
        const hasUnread = state.recentAlerts.some((a) => a.terminalId === terminalId && !a.isRead);

        return hasUnread
          ? {
              terminals: state.terminals.map((t) =>
                t.terminalId === terminalId ? { ...t, enabled: false } : t,
              ),
            }
          : { terminals: state.terminals.filter((t) => t.terminalId !== terminalId) };
      });
    },

    /** Re-runs the check above once the last unread alert is cleared. */
    checkAndRemoveDisabledTerminal(terminalId: number) {
      patchState(store, (state) => {
        const terminal = state.terminals.find((t) => t.terminalId === terminalId);
        if (terminal?.enabled !== false) return state;

        const hasUnread = state.recentAlerts.some((a) => a.terminalId === terminalId && !a.isRead);
        if (hasUnread) return state;

        return { terminals: state.terminals.filter((t) => t.terminalId !== terminalId) };
      });
    },

    /**
     * A terminal the trader can now see — brand new, or switched back on.
     *
     * The payload is a whole card, so one that was not in the store arrives
     * ready to render: balance, goal, bank, link and pending total are all on
     * it. It used to carry `{ terminalId, cardId }` and nothing else, which
     * meant a near-empty row that filled itself in whenever the scraper next
     * broadcast a balance.
     *
     * A terminal already in the store is **merged into, not replaced.** The
     * event carries the figures we last stored; a card already on screen may be
     * holding fresher ones from a live balance push, and overwriting those
     * would walk the number backwards in front of the trader.
     */
    enableOrAddTerminal(terminal: Terminal) {
      patchState(store, (state) => {
        const index = state.terminals.findIndex((t) => t.terminalId === terminal.terminalId);
        if (index === -1) return { terminals: [...state.terminals, terminal] };

        return {
          // `.map` rather than `.with`, which needs the ES2023 lib this app
          // does not target.
          terminals: state.terminals.map((held, at) =>
            at === index
              ? {
                  ...terminal,
                  ...held,
                  // The one thing this event is authoritative about.
                  enabled: true,
                }
              : held,
          ),
        };
      });
    },

    setTerminalExpanded(terminalId: number, expanded: boolean) {
      patchState(store, (state) => ({
        expandedTerminals: { ...state.expandedTerminals, [terminalId]: expanded },
      }));
    },

    toggleTerminalExpanded(terminalId: number) {
      patchState(store, (state) => ({
        expandedTerminals: {
          ...state.expandedTerminals,
          [terminalId]: !state.expandedTerminals[terminalId],
        },
      }));
    },

    clear() {
      patchState(store, initialState);
    },
  })),
);
