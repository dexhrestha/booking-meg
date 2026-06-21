"use client";

import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  usePopover,
} from "@/components/ui/popover";
import {
  formatDisplayDate,
  getLatestFirstSessionDate,
  isAllowedFirstSessionDate,
} from "@/lib/booking";

type FirstSessionDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
  disabled?: boolean;
  isDateUnavailable?: (date: Date) => boolean;
  note?: string;
  placeholder?: string;
};

function dateFromIso(value: string) {
  if (!value) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) {
    return undefined;
  }

  return new Date(year, month - 1, day);
}

function dateToIso(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isUnavailableFirstSessionDate(date: Date) {
  return !isAllowedFirstSessionDate(dateToIso(date));
}

export function FirstSessionDatePicker({
  value,
  onChange,
  onBlur,
  invalid,
  disabled = false,
  isDateUnavailable = isUnavailableFirstSessionDate,
  note = `Select a Tuesday within the next 4 weeks, through ${formatDisplayDate(getLatestFirstSessionDate())}.`,
  placeholder = "Pick a date",
}: FirstSessionDatePickerProps) {
  const selectedDate = dateFromIso(value);

  return (
    <Popover>
      <PopoverTrigger disabled={disabled}>
        <span>{value ? formatDisplayDate(value) : placeholder}</span>
      </PopoverTrigger>
      <PopoverContent>
        <DatePickerCalendar
          selectedDate={selectedDate}
          onChange={onChange}
          onBlur={onBlur}
          invalid={invalid}
          isDateUnavailable={isDateUnavailable}
          note={note}
        />
      </PopoverContent>
    </Popover>
  );
}

function DatePickerCalendar({
  selectedDate,
  onChange,
  onBlur,
  invalid,
  isDateUnavailable,
  note,
}: {
  selectedDate?: Date;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid: boolean;
  isDateUnavailable: (date: Date) => boolean;
  note: string;
}) {
  const { setOpen } = usePopover();

  return (
    <>
      <Calendar
        selected={selectedDate}
        onSelect={(date) => {
          if (!date) {
            return;
          }

          onChange(dateToIso(date));
          onBlur();
          setOpen(false);
        }}
        disabled={isDateUnavailable}
      />
      <p className="date-picker-note" data-invalid={invalid}>
        {note}
      </p>
    </>
  );
}
