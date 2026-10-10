async function initialize() {
  const response = await fetch('/openapi.json', { credentials: 'omit' });
  if (!response.ok) throw new Error('OpenAPI could not be loaded.');
  const spec = await response.json();
  // The explorer requires explicit bearer authorization, independent of admin cookies.
  delete spec.components.securitySchemes.operatorCookie;
  for (const path of Object.values(spec.paths)) {
    for (const operation of Object.values(path)) {
      if (operation?.security) operation.security = operation.security.filter(scheme => !scheme.operatorCookie);
    }
  }
  SwaggerUIBundle({
    spec,
    dom_id: '#swagger-ui',
    deepLinking: true,
    filter: true,
    displayOperationId: true,
    displayRequestDuration: true,
    defaultModelsExpandDepth: -1,
    validatorUrl: null,
    persistAuthorization: false,
    queryConfigEnabled: false,
    supportedSubmitMethods: ['get', 'post'],
    requestInterceptor(request) {
      request.credentials = 'omit';
      return request;
    }
  });
}
initialize().catch(() => {
  document.getElementById('swagger-ui').textContent = 'Unable to load API documentation. Check server readiness and reload this page.';
});
