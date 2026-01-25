module github.com/pocketping/bridge-server

go 1.22

require (
	github.com/Ruwad-io/pocketping/sdk-go v0.0.0
	github.com/joho/godotenv v1.5.1
)

// Use local sdk-go package
replace github.com/Ruwad-io/pocketping/sdk-go => ../packages/sdk-go
