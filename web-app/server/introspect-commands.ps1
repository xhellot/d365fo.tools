<#
    Emits the d365fo.tools command catalog as JSON on stdout.

    The web app builds its forms from this, so a parameter shown in the UI is by
    construction a parameter the cmdlet really has. Hand-maintained lists drift;
    this cannot.

    Takes roughly a minute for the whole module, almost all of it in Get-Help
    parsing comment-based help. The caller caches the result to disk, so this
    runs once per module version rather than once per start.
#>
[CmdletBinding()]
param ()

$ErrorActionPreference = 'Stop'

Import-Module d365fo.tools -Force -ErrorAction Stop

# Supplied by PowerShell itself, never by the user.
$commonParameters = @(
    'Verbose', 'Debug', 'ErrorAction', 'WarningAction', 'InformationAction', 'ProgressAction',
    'ErrorVariable', 'WarningVariable', 'InformationVariable', 'OutVariable', 'OutBuffer',
    'PipelineVariable', 'WhatIf', 'Confirm'
)

function Get-CleanText {
    param ([object] $Value)

    $text = ($Value | ForEach-Object { $_.Text }) -join ' '
    if (-not $text) { return '' }

    # Collapse the hard-wrapped comment-based help into a single line.
    ($text -replace '\s+', ' ').Trim()
}

$catalog = foreach ($command in Get-Command -Module d365fo.tools -CommandType Function) {

    $help = Get-Help $command.Name -ErrorAction SilentlyContinue
    $parameterHelp = @{}
    foreach ($helpParameter in $help.parameters.parameter) {
        if ($helpParameter.Name -and -not $parameterHelp.ContainsKey($helpParameter.Name)) {
            $parameterHelp[$helpParameter.Name] = Get-CleanText $helpParameter.description
        }
    }

    $synopsis = ''
    if ($help.Synopsis) { $synopsis = ($help.Synopsis -replace '\s+', ' ').Trim() }
    # PowerShell synthesises a usage line when there is no real synopsis.
    if ($synopsis -like "$($command.Name) *") { $synopsis = '' }

    $parameters = foreach ($parameter in $command.Parameters.Values) {
        if ($parameter.Name -in $commonParameters) { continue }

        $parameterAttributes = @($parameter.Attributes |
            Where-Object { $_ -is [System.Management.Automation.ParameterAttribute] })

        $validateSet = @($parameter.Attributes |
            Where-Object { $_ -is [System.Management.Automation.ValidateSetAttribute] } |
            ForEach-Object { $_.ValidValues } |
            Select-Object -Unique)

        $typeName = $parameter.ParameterType.Name

        [ordered]@{
            name        = $parameter.Name
            type        = $typeName
            isSwitch    = ($typeName -eq 'SwitchParameter')
            isArray     = $parameter.ParameterType.IsArray
            mandatory   = [bool]($parameterAttributes | Where-Object { $_.Mandatory })
            validateSet = $validateSet
            aliases     = @($parameter.Aliases)
            help        = [string]$parameterHelp[$parameter.Name]
        }
    }

    $parameterSets = foreach ($set in $command.ParameterSets) {
        [ordered]@{
            name       = $set.Name
            isDefault  = $set.IsDefault
            parameters = @($set.Parameters |
                Where-Object { $_.Name -notin $commonParameters } |
                ForEach-Object { $_.Name })
        }
    }

    [ordered]@{
        name          = $command.Name
        verb          = $command.Verb
        noun          = $command.Noun
        synopsis      = $synopsis
        parameters    = @($parameters)
        parameterSets = @($parameterSets)
    }
}

[ordered]@{
    moduleVersion = (Get-Module d365fo.tools).Version.ToString()
    generatedAt   = (Get-Date).ToString('o')
    commands      = @($catalog)
} | ConvertTo-Json -Depth 8 -Compress
