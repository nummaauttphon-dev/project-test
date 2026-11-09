// No imports on purpose: client components read this, and file-type must stay out of their bundle.

/** The largest slip or product image accepted, 4 MB. The Storage buckets enforce the same limit. */
export const MAX_IMAGE_BYTES = 4_194_304;
