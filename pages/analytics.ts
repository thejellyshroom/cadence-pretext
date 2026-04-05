/**
 * Vercel Web Analytics initialization for Cadence Pretext.
 * This module initializes analytics tracking on all pages.
 */
import { inject } from '@vercel/analytics'

// Initialize Vercel Web Analytics
// The analytics will only track in production mode by default
inject()
