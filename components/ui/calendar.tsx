"use client";

import { useMemo, useState } from "react";

type CalendarProps = {
  selected?: Date;
  onSelect?: (date: Date | undefined) => void;
  disabled?: (date: Date) => boolean;
  className?: string;
};

const weekdayLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function sameDay(first?: Date, second?: Date) {
  return (
    first?.getFullYear() === second?.getFullYear() &&
    first?.getMonth() === second?.getMonth() &&
    first?.getDate() === second?.getDate()
  );
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function getCalendarDays(month: Date) {
  const firstDay = startOfMonth(month);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

export function Calendar({
  selected,
  onSelect,
  disabled,
  className = "",
}: CalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selected ?? new Date()),
  );
  const days = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);

  return (
    <div className={`calendar ${className}`} role="application">
      <div className="calendar-header">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
        >
          ‹
        </button>
        <strong>{monthLabel}</strong>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
        >
          ›
        </button>
      </div>

      <div className="calendar-grid calendar-weekdays">
        {weekdayLabels.map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {days.map((day) => {
          const unavailable = disabled?.(day) ?? false;
          const outsideMonth = day.getMonth() !== visibleMonth.getMonth();
          const selectedDay = sameDay(day, selected);

          return (
            <button
              type="button"
              key={day.toISOString()}
              className="calendar-day"
              data-outside={outsideMonth}
              data-selected={selectedDay}
              disabled={unavailable}
              onClick={() => onSelect?.(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
