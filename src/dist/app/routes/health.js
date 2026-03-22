export async function healthRoutes(app) {
    app.get("/health", async () => {
        return {
            status: "ok",
            service: "bff-backoffice",
            timestamp: new Date().toISOString(),
        };
    });
}
