const baseUrl = (process.env.LHCI_BASE_URL || "http://localhost:3000").replace(/\/$/, "");

module.exports = {
  ci: {
    collect: {
      url: ["/", "/proof", "/proof/case-study", "/login"].map((path) => baseUrl + path),
      numberOfRuns: 1,
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.9 }],
        "categories:accessibility": ["error", { minScore: 0.98 }],
        "categories:best-practices": ["warn", { minScore: 0.95 }],
        "categories:seo": ["error", { minScore: 0.95 }],
      },
    },
    upload: { target: "temporary-public-storage" },
  },
};
