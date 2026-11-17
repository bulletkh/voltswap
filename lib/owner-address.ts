// Public treasury / owner address (same as the fee receiver). Safe to import on the client.
export const OWNER = (process.env.NEXT_PUBLIC_FEE_RECEIVER || "0x7211d7a33c32b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955cab12").toLowerCase();
