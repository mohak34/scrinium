// A Google event as the tasks calendar receives it from /api/calendar/events.
// All-day events keep Google's date-only strings ("2026-10-07") so the
// browser, not the UTC server, decides which local day they fall on; timed
// events carry ISO instants. Ends are exclusive, as Google sends them.
export interface CalendarEvent {
	id: string;
	calendar: string;
	color: string | null;
	title: string;
	start: string;
	end: string;
	allDay: boolean;
}

// Local midnight for date-only values, the instant otherwise.
function instant(value: string, allDay: boolean): number {
	return new Date(allDay ? `${value}T00:00:00` : value).getTime();
}

export function eventStart(e: CalendarEvent): number {
	return instant(e.start, e.allDay);
}

// True when any part of the event falls on the given local day. A
// zero-length event still shows on its start day.
export function eventOnDay(e: CalendarEvent, day: Date): boolean {
	const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
	const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
	const start = eventStart(e);
	const end = Math.max(instant(e.end, e.allDay), start + 1);
	return start < to && end > from;
}
