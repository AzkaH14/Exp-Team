export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error instanceof Event) {
    return "A network or loading error occurred. Please refresh the page.";
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "An unexpected error occurred. Try refreshing the page.";
}
