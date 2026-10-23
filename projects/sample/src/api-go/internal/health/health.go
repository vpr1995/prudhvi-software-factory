// Package health serves GET /v1/health.
package health

import (
	"net/http"

	"github.com/vprprudhvi/sample/api-go/internal/apierror"
	"github.com/vprprudhvi/sample/api-go/internal/gen"
)

// Handler returns the handler of GET /v1/health.
func Handler(serviceName, serviceVersion string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		apierror.WriteJSON(w, http.StatusOK, gen.Health{
			Status:  gen.Ok,
			Service: serviceName,
			Version: serviceVersion,
		})
	}
}
