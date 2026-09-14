import type { Metadata } from "next";

import { Viewer } from "@/components/viewer";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  // `absolute` opts out of the root layout's "%s · Markdown Preview" template,
  // which would otherwise stutter the site name on the home page.
  title: { absolute: SITE_NAME },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
  },
};

export default function Home() {
  return <Viewer />;
}
