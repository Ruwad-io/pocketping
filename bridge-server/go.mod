module github.com/pocketping/bridge-server

go 1.22

require (
	github.com/Ruwad-io/pocketping/sdk-go v0.0.0
	github.com/joho/godotenv v1.5.1
)

// Use local sdk-go package (../packages/sdk-go for local, /packages/sdk-go for Docker)
replace github.com/Ruwad-io/pocketping/sdk-go => /packages/sdk-go
