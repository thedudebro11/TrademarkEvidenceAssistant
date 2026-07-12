import { PageHeader } from "../components/layout/PageHeader.js";
import { ReviewQueue } from "../ReviewQueue.js";

export function ReviewPage() {
  return (
    <>
      <PageHeader title="Review" />
      <ReviewQueue />
    </>
  );
}
