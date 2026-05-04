FROM mcr.microsoft.com/dotnet/sdk:8.0-jammy AS build
WORKDIR /src
COPY . .
RUN dotnet publish G5AdvisorService.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/sdk:8.0-jammy
WORKDIR /app
COPY --from=build /app/publish .
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENV ASPNETCORE_URLS=http://0.0.0.0:8002
EXPOSE 8002
ENTRYPOINT ["/app/entrypoint.sh"]
