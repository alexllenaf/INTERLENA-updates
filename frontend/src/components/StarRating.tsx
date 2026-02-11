import React from "react";

type StarRatingProps = {
  value?: number | null;
  onChange?: (next: number | null) => void;
  size?: "sm" | "md";
  readonly?: boolean;
  step?: 0.5 | 1;
};

const clamp = (value: number) => Math.max(0, Math.min(5, value));

const StarRating: React.FC<StarRatingProps> = ({
  value,
  onChange,
  size = "md",
  readonly,
  step = 1
}) => {
  const current = clamp(value ?? 0);

  const handleClick = (next: number) => {
    if (!onChange || readonly) return;
    if (current === next) {
      onChange(null);
      return;
    }
    onChange(next);
  };

  return (
    <div className={`star-rating ${size} ${readonly ? "readonly" : ""}`}>
      {Array.from({ length: 5 }, (_, index) => {
        const rating = index + 1;
        const fill = Math.max(0, Math.min(1, current - index));
        return (
          <button
            key={rating}
            type="button"
            className="star"
            onClick={(event) => {
              if (!onChange || readonly) return;
              if (step === 1) {
                handleClick(rating);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              const isHalf = event.clientX - rect.left <= rect.width / 2;
              const next = isHalf ? index + 0.5 : rating;
              handleClick(next);
            }}
            aria-label={`Rate ${rating} star${rating === 1 ? "" : "s"}`}
            disabled={readonly}
          >
            <span className="star-base">☆</span>
            <span className="star-fill" style={{ width: `${fill * 100}%` }}>
              ★
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default StarRating;
